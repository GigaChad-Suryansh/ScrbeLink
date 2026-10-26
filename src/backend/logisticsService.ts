/**
 * backend/logisticsService.ts
 * Scribe records, courier dispatch, delivery codes, disputes and the message log, in Postgres.
 * The courier and the SMS/WhatsApp gateway are still simulated.
 */

import type { Queryable } from './db'
import { constantTimeEqual, randomDigits, randomToken } from '../shared/random'
import type { CourierTask, NotificationLog, DisputeRecord, AdminScribeApproval } from '../shared/logisticsDisputes'
import { adjustStrikes, type DisputeOutcome } from './scheduler'

// ── Scribes ──────────────────────────────────────────────────────────────────

const SCRIBE_SELECT = `
  SELECT s.*, COALESCE(k.strikes, 0) AS strikes, COALESCE(k.is_suspended, false) AS is_suspended
  FROM scribes s LEFT JOIN scribe_strikes k ON k.scribe_id = s.scribe_id`

const toScribe = (r: any): AdminScribeApproval => ({
  scribeId: r.scribe_id,
  name: r.name,
  college: r.college,
  tag: r.tag,
  sampleCardText: r.sample_card_text,
  handwritingSampleUrl: r.sample_image_url,
  isApproved: r.is_approved,
  strikes: r.strikes,
  isSuspended: r.is_suspended,
  phone: r.phone ?? undefined,
  upiVpa: r.upi_vpa ?? undefined,
  specialties: r.specialties,
})

export async function getScribe(q: Queryable, scribeId: string): Promise<AdminScribeApproval | undefined> {
  const rows = await q.query(`${SCRIBE_SELECT} WHERE s.scribe_id = $1`, [scribeId])
  return rows[0] ? toScribe(rows[0]) : undefined
}

export async function getAllScribes(q: Queryable): Promise<AdminScribeApproval[]> {
  return (await q.query(`${SCRIBE_SELECT} ORDER BY s.created_at, s.scribe_id`)).map(toScribe)
}

/** A scribe signs up or edits their profile. New scribes start unapproved; a new sample card needs re-review. */
export async function upsertScribe(
  q: Queryable,
  p: { scribeId: string; phone: string; name: string; college: string; sampleCardText: string; upiVpa: string; specialties: string[]; sampleImageUrl?: string },
): Promise<AdminScribeApproval> {
  const existing = await getScribe(q, p.scribeId)
  const newImage = p.sampleImageUrl !== undefined && p.sampleImageUrl !== existing?.handwritingSampleUrl
  const changedCard = !!existing && (existing.sampleCardText !== p.sampleCardText || newImage)
  const image = p.sampleImageUrl ?? existing?.handwritingSampleUrl ?? ''
  await q.query(
    `INSERT INTO scribes (scribe_id, phone, name, college, tag, sample_card_text, sample_image_url, upi_vpa, specialties)
     VALUES ($1,$2,$3,$4,$1,$5,$6,$7,$8::jsonb)
     ON CONFLICT (scribe_id) DO UPDATE SET
       name = $3, college = $4, sample_card_text = $5, sample_image_url = $6, upi_vpa = $7, specialties = $8::jsonb,
       phone = $2, is_approved = CASE WHEN $9 THEN false ELSE scribes.is_approved END`,
    [p.scribeId, p.phone, p.name, p.college, p.sampleCardText, image, p.upiVpa, JSON.stringify(p.specialties), changedCard],
  )
  return (await getScribe(q, p.scribeId))!
}

export async function verifyScribeCard(q: Queryable, scribeId: string, isApproved: boolean): Promise<AdminScribeApproval> {
  const rows = await q.query('UPDATE scribes SET is_approved = $2 WHERE scribe_id = $1 RETURNING scribe_id', [scribeId, isApproved])
  if (!rows.length) throw new Error('Scribe not found')
  return (await getScribe(q, scribeId))!
}

export async function manageScribeStrike(q: Queryable, scribeId: string, delta: number): Promise<AdminScribeApproval> {
  if (!(await getScribe(q, scribeId))) throw new Error('Scribe not found')
  await adjustStrikes(q, scribeId, delta, `Admin ${delta > 0 ? 'issued' : 'pardoned'} a strike`)
  return (await getScribe(q, scribeId))!
}

// ── Courier dispatch ─────────────────────────────────────────────────────────

const DEMO_PHONE = '+919876543210'

export async function createCourierDispatch(
  q: Queryable,
  orderId: string,
  dropGate = 'Gate 1, DTU Main Campus',
  pickupAddress = 'Hostel Block 4, DTU',
  partner: 'Borzo' | 'Porter' = 'Borzo',
  /** Reuse the order's own code so the customer sees one code everywhere. */
  orderOtp?: string,
  customerPhone?: string,
): Promise<CourierTask> {
  const deliveryOtp = orderOtp ?? randomDigits(6)
  const task: CourierTask = {
    trackingId: `${partner.toUpperCase()}-${randomDigits(6)}`,
    courierPartner: partner,
    orderId,
    pickupAddress,
    dropGate,
    courierRiderName: partner === 'Borzo' ? 'Ramesh Kumar (Borzo Rider)' : 'Suraj Singh (Porter Fleet)',
    courierRiderPhone: '+91 98111 22334',
    deliveryOtp,
    status: 'OUT_FOR_DELIVERY',
    createdAt: new Date().toISOString(),
  }
  await q.query(
    'INSERT INTO courier_tasks (order_id, task) VALUES ($1,$2::jsonb) ON CONFLICT (order_id) DO UPDATE SET task = $2::jsonb',
    [orderId, JSON.stringify(task)],
  )
  await sendNotification(
    q,
    customerPhone ?? DEMO_PHONE,
    'WHATSAPP',
    'COURIER_DISPATCHED',
    `📦 ScribeLink: Courier ${task.courierRiderName} is on the way to ${dropGate}. Your Delivery OTP is ${deliveryOtp}.`,
  )
  return task
}

export async function getCourierTask(q: Queryable, orderId: string): Promise<CourierTask | undefined> {
  const rows = await q.query<{ task: CourierTask }>('SELECT task FROM courier_tasks WHERE order_id = $1', [orderId])
  return rows[0]?.task
}

export async function confirmGateDelivery(
  q: Queryable,
  orderId: string,
  providedOtp: string,
  gateDropPhotoUrl?: string,
  customerPhone?: string,
): Promise<{ success: boolean; task?: CourierTask; error?: string }> {
  const task = await getCourierTask(q, orderId)
  if (!task) return { success: false, error: 'Courier task not found for order' }
  if (typeof providedOtp !== 'string' || !constantTimeEqual(task.deliveryOtp, providedOtp.trim())) {
    return { success: false, error: 'Invalid Delivery OTP! Handover denied.' }
  }

  task.status = 'DELIVERED_AT_GATE'
  task.deliveredAt = new Date().toISOString()
  task.gateDropPhotoUrl =
    gateDropPhotoUrl ||
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="%23e2e8f0"/><text x="150" y="100" font-family="sans-serif" font-size="14" font-weight="bold" fill="%23475569" text-anchor="middle">GATE DROP PHOTO VERIFIED</text></svg>'
  await q.query('UPDATE courier_tasks SET task = $2::jsonb WHERE order_id = $1', [orderId, JSON.stringify(task)])
  await sendNotification(
    q,
    customerPhone ?? DEMO_PHONE,
    'WHATSAPP',
    'DELIVERY_CONFIRMED',
    `🎉 ScribeLink: Your manuscript has been safely handed over at ${task.dropGate}. 24-hour dispute window has begun.`,
  )
  return { success: true, task }
}

// ── Disputes ─────────────────────────────────────────────────────────────────

export async function fileDispute(
  q: Queryable,
  orderId: string,
  reason: DisputeRecord['reason'],
  unboxingVideoUrl: string,
  customerNotes: string,
  customerName = 'Customer',
  scribeId = '',
  amount = 0,
  scribeName = scribeId,
): Promise<DisputeRecord> {
  const dispute: DisputeRecord = {
    id: `DISP-${randomToken(3)}`,
    orderId,
    openedByUserId: 'customer',
    customerName,
    scribeId,
    scribeName,
    amount,
    reason,
    unboxingVideoUrl,
    customerNotes,
    status: 'PENDING_REVIEW',
    openedAt: new Date().toISOString(),
  }
  await q.query('INSERT INTO disputes (id, order_id, status, record) VALUES ($1,$2,$3,$4::jsonb)', [dispute.id, orderId, dispute.status, JSON.stringify(dispute)])
  await sendNotification(
    q,
    DEMO_PHONE,
    'SMS',
    'DISPUTE_FILED',
    `⚠️ ScribeLink: A dispute (${dispute.id}) was opened on Order #${orderId}. Escrow release is frozen pending video review.`,
  )
  return dispute
}

export async function getAllDisputes(q: Queryable): Promise<DisputeRecord[]> {
  return (await q.query<{ record: DisputeRecord; status: string }>('SELECT record, status FROM disputes ORDER BY created_at DESC, id')).map((r) => ({ ...r.record, status: r.status as DisputeRecord['status'] }))
}

export async function resolveDispute(q: Queryable, disputeId: string, decision: DisputeOutcome, adminNotes: string): Promise<DisputeRecord> {
  const rows = await q.query<{ record: DisputeRecord }>('SELECT record FROM disputes WHERE id = $1 FOR UPDATE', [disputeId])
  if (!rows.length) throw new Error('Dispute record not found')
  const resolved: DisputeRecord = { ...rows[0].record, status: decision, adminNotes, resolvedAt: new Date().toISOString() }
  await q.query('UPDATE disputes SET status = $2, record = $3::jsonb WHERE id = $1', [disputeId, decision, JSON.stringify(resolved)])
  return resolved
}

// ── Message log (WhatsApp / SMS) ─────────────────────────────────────────────

export async function sendNotification(q: Queryable, recipient: string, channel: 'WHATSAPP' | 'SMS', templateName: string, content: string): Promise<NotificationLog> {
  const log: NotificationLog = {
    id: `NOTIF-${Date.now()}-${randomToken(2)}`,
    channel,
    recipient,
    templateName,
    content,
    sentAt: new Date().toLocaleTimeString(),
    status: 'DELIVERED',
  }
  await q.query('INSERT INTO notifications (record) VALUES ($1::jsonb)', [JSON.stringify(log)])
  return log
}

export async function getNotificationLogs(q: Queryable): Promise<NotificationLog[]> {
  return (await q.query<{ record: NotificationLog }>('SELECT record FROM notifications ORDER BY id DESC LIMIT 25')).map((r) => r.record)
}

// ── Demo data ────────────────────────────────────────────────────────────────

/** Sample scribes so a fresh demo has something to show. Only used when SEED_DEMO=true. */
export async function seedDemoData(q: Queryable): Promise<void> {
  const samples = [
    { id: 'S-2041', name: 'Ananya R.', college: 'Delhi Technological University (DTU)', text: "Newton's second law: F = ma. The acceleration of a body is directly proportional to the net force.", approved: true },
    { id: 'S-1887', name: 'Rohan M.', college: 'IIT Delhi', text: 'The French Revolution began in 1789 with the storming of the Bastille.', approved: true },
    { id: 'S-9011', name: 'Pooja K.', college: 'Netaji Subhas University of Technology (NSUT)', text: 'Integration by parts formula: uv - integral v du.', approved: false },
  ]
  for (const s of samples) {
    await q.query(
      `INSERT INTO scribes (scribe_id, name, college, tag, sample_card_text, is_approved) VALUES ($1,$2,$3,$1,$4,$5) ON CONFLICT DO NOTHING`,
      [s.id, s.name, s.college, s.text, s.approved],
    )
  }
}
