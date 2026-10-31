/**
 * backend/server.ts
 * Express API for ScribeLink. Data lives in Postgres (see db.ts and migrations.ts).
 *
 * - Signed session tokens and role guards on every route that changes or reveals order data
 * - Admins come from an allowlist (ADMIN_PHONES); nobody can request the admin role
 * - Rate limits, brute-force lockouts, strict input validation
 * - Delivery code is only ever shown to the customer who owns the order
 * - Every change to an order runs in one transaction with the order row locked, so two requests
 *   cannot move the same order twice or pay out the same money twice
 * - Disputes freeze escrow; rush reassignment updates the order itself
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { MIN_ORDER_MESSAGE, calculateQuote, checkCoverPage, meetsMinimum, countWords, sanitizeText } from '../shared/rules'
import { validateUpload } from '../shared/upload'
import {
  ALLOWED_TRANSITIONS,
  validateTransition,
  computeDeadlines,
  computeIntakeDeadline,
  computeNextCheckInDeadline,
  type OrderStateEnum,
} from '../shared/stateMachine'
import { createDb, type Db, type Queryable } from './db'
import { createUpiPaymentIntent, type UpiPaymentIntent } from './paymentGateway'
import * as sched from './scheduler'
import * as logi from './logisticsService'
import {
  AttemptLimiter,
  adminPhones,
  assertProductionConfig,
  isProduction,
  randomDigits,
  randomToken,
  requireAdminOrCron,
  requireAuth,
  safeEqual,
  scribeIdFor,
  sessionOf,
  signSession,
  type Role,
  type Session,
} from './security'
import {
  ValidationError,
  bool,
  idLike,
  int,
  mediaUrl,
  oneOf,
  optInt,
  optStr,
  phone,
  rupees,
  str,
  upiId,
} from './validate'

const PORT = process.env.PORT || 4000
const FIFTEEN_MIN = 15 * 60 * 1000

// ── Types ────────────────────────────────────────────────────────────────────

interface OrderDoc {
  id: string
  /** Owner. Customers can only see their own orders. */
  customerPhone?: string
  title: string
  subject: string
  status: OrderStateEnum
  customerTotal: number
  scribePayout: number
  scribeId?: string
  scribeName?: string
  pages: number
  words: number
  deliveryOtp: string
  addons: string[]
  penStyle: string
  /** If set, only this scribe sees the order in their pool. */
  preferredScribeId?: string
  createdAt: string
  intakeDeadline?: string
  nextCheckInDue?: string
  finalDeadline: string
  timeline: Array<{ status: string; timestamp: string; note: string }>
}

/** A failure the client should see, with the status to send. Throwing inside a transaction rolls it back. */
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const forbid = (msg = 'You are not allowed to do this') => new HttpError(403, msg)
const notFound = (msg: string) => new HttpError(404, msg)

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined)

const orderFromRow = (r: any): OrderDoc => ({
  id: r.id,
  customerPhone: r.customer_phone ?? undefined,
  title: r.title,
  subject: r.subject,
  status: r.status,
  customerTotal: r.customer_total,
  scribePayout: r.scribe_payout,
  scribeId: r.scribe_id ?? undefined,
  scribeName: r.scribe_name ?? undefined,
  pages: r.pages,
  words: r.words,
  deliveryOtp: r.delivery_otp,
  addons: r.addons,
  penStyle: r.pen_style,
  preferredScribeId: r.preferred_scribe_id ?? undefined,
  createdAt: iso(r.created_at)!,
  intakeDeadline: iso(r.intake_deadline),
  nextCheckInDue: iso(r.next_check_in_due),
  finalDeadline: r.final_deadline,
  timeline: r.timeline,
})

/** Reads an order. With lock, the row stays locked until the surrounding transaction ends. */
async function fetchOrder(q: Queryable, id: string, lock = false): Promise<OrderDoc | undefined> {
  const rows = await q.query(`SELECT * FROM orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? orderFromRow(rows[0]) : undefined
}

async function insertOrder(q: Queryable, o: OrderDoc): Promise<void> {
  await q.query(
    `INSERT INTO orders (id, customer_phone, title, subject, status, customer_total, scribe_payout, preferred_scribe_id,
       pages, words, delivery_otp, addons, pen_style, final_deadline, timeline, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16)`,
    [o.id, o.customerPhone ?? null, o.title, o.subject, o.status, o.customerTotal, o.scribePayout, o.preferredScribeId ?? null,
      o.pages, o.words, o.deliveryOtp, JSON.stringify(o.addons), o.penStyle, o.finalDeadline, JSON.stringify(o.timeline), o.createdAt],
  )
}

async function saveOrder(q: Queryable, o: OrderDoc): Promise<void> {
  await q.query(
    `UPDATE orders SET status=$2, scribe_id=$3, scribe_name=$4, intake_deadline=$5, next_check_in_due=$6, timeline=$7::jsonb WHERE id=$1`,
    [o.id, o.status, o.scribeId ?? null, o.scribeName ?? null, o.intakeDeadline ?? null, o.nextCheckInDue ?? null, JSON.stringify(o.timeline)],
  )
}

const STATES = Object.keys(ALLOWED_TRANSITIONS) as OrderStateEnum[]
const SCRIBE_TARGETS = new Set<OrderStateEnum>(['Accepted', 'Writing', 'Dispatched'])
const CUSTOMER_TARGETS = new Set<OrderStateEnum>(['Cancelled', 'Closed'])

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(os.tmpdir(), 'scribelink-uploads')
const MEDIA_PATH = /^\/api\/media\/[a-f0-9]{32}$/
const SAMPLE_PATH = /^\/api\/samples\/[a-f0-9]{32}$/
const IMAGE_TYPES = ['png', 'jpeg', 'webp'] as const

/** Stored files are named <id>.<detected type>, so the type never comes from the client. */
function findUpload(id: string, types: readonly string[]): { file: string; type: string } | undefined {
  for (const type of types) {
    const file = path.join(UPLOAD_DIR, `${id}.${type}`)
    if (fs.existsSync(file)) return { file, type }
  }
  return undefined
}

function storeUpload(bytes: Buffer, type: string): string {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  const id = randomToken(16).toLowerCase()
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.${type}`), bytes, { mode: 0o600 })
  return id
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const bodyOf = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}

const demoOtpEnabled = () => !isProduction() || process.env.DEMO_OTP === 'true'
const testPaymentsAllowed = () => !isProduction() || process.env.ALLOW_TEST_PAYMENTS === 'true'

const ownsOrder = (o: OrderDoc, s: Session) => o.customerPhone !== undefined && o.customerPhone === s.phone

/** Customers see only their own orders. Scribes and admins see any (scribes only see IDs, never owners). */
const canView = (o: OrderDoc, s: Session) => s.role !== 'customer' || ownsOrder(o, s)

/** Strips the delivery code unless the viewer is the owning customer or an admin. */
function publicOrder(o: OrderDoc, s: Session): Omit<OrderDoc, 'customerPhone' | 'deliveryOtp'> & { deliveryOtp?: string } {
  const { customerPhone: _owner, deliveryOtp, ...rest } = o
  return s.role === 'admin' || ownsOrder(o, s) ? { ...rest, deliveryOtp } : rest
}

/** Loads an order the signed-in user may see, or throws 404. */
async function loadVisible(q: Queryable, id: string, s: Session, lock = false): Promise<OrderDoc> {
  const order = await fetchOrder(q, id, lock)
  if (!order || !canView(order, s)) throw notFound('Order not found')
  return order
}

async function newOrderId(q: Queryable): Promise<string> {
  for (;;) {
    const id = `SL-${randomDigits(4)}`
    if (!(await fetchOrder(q, id))) return id
  }
}

/** Moves an order to a new state and runs that state's side effects. The caller has already validated it. */
async function applyTransition(q: Queryable, order: OrderDoc, next: OrderStateEnum, note: string): Promise<void> {
  order.status = next
  // Check-ins only matter while the scribe is writing. After that, a late timer must not cost them a strike.
  if (next !== 'Writing') await sched.closeRushWatch(q, order.id)

  if (next === 'Accepted') {
    order.intakeDeadline = computeIntakeDeadline().toISOString()
  } else if (next === 'Writing' && order.scribeId) {
    const due = computeNextCheckInDeadline()
    order.nextCheckInDue = due.toISOString()
    await sched.registerRushWatch(q, order.id, order.scribeId, order.scribeName ?? order.scribeId, due)
  } else if (next === 'Delivered' && order.scribeId) {
    await sched.registerEscrowClock(q, order.id, order.scribeId, order.scribePayout)
  }

  order.timeline.push({ status: next, timestamp: new Date().toISOString(), note })
  await saveOrder(q, order)
}

/** A scribe may take work only once an admin has approved their handwriting card. */
async function scribeCanWork(q: Queryable, phoneNumber: string): Promise<boolean> {
  const rec = await logi.getScribe(q, scribeIdFor(phoneNumber))
  return !!rec && rec.isApproved && !rec.isSuspended
}

function addonLabels(b: { simpleDrawings: number; complexDrawings: number; graphs: number; customTemplate: boolean }, pages: number): string[] {
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`
  return [
    b.simpleDrawings > 0 && plural(b.simpleDrawings, 'Simple Diagram'),
    b.complexDrawings > 0 && plural(b.complexDrawings, 'Complex Diagram'),
    b.graphs > 0 && plural(b.graphs, 'Graph'),
    b.customTemplate && 'College Template',
    pages >= 20 && 'Rigid Packaging',
  ].filter((a): a is string => Boolean(a))
}

/** Evidence is either a public https link or a file this server stored itself. */
function evidenceUrl(v: unknown, name: string): string {
  if (typeof v === 'string' && MEDIA_PATH.test(v)) {
    if (!findUpload(v.slice('/api/media/'.length), ['mp4'])) throw new ValidationError(`${name} refers to a missing upload`)
    return v
  }
  return mediaUrl(v, name)
}

/** Releases due escrow and reassigns ghosted orders, all in one transaction. */
export async function runScheduledJobs(db: Db, now: Date) {
  return db.tx(async (q) => {
    const escrowReleased = await sched.runEscrowReleaseJob(q, now)
    const rushResults = await sched.runRushMonitorJob(q, now)

    // A strike without taking the order away would leave a ghosting scribe assigned.
    for (const id of rushResults.reassignedOrderIds) {
      const order = await fetchOrder(q, id, true)
      if (order && validateTransition(order.status, 'Reassigned').success) {
        order.scribeId = undefined
        order.scribeName = undefined
        order.nextCheckInDue = undefined
        await applyTransition(q, order, 'Reassigned', 'Missed hourly check-in. Returned to the pool; restart from page 1.')
      }
    }
    return { escrowReleased, rushResults }
  })
}

// ── Scribe wallet ────────────────────────────────────────────────────────────

async function walletOf(q: Queryable, scribeId: string) {
  const escrow = await sched.getEscrowRecordsFor(q, scribeId)
  const paidOut = await q.query<{ id: string; amount: number; created_at: Date }>(
    'SELECT id, amount, created_at FROM withdrawals WHERE scribe_id = $1 ORDER BY created_at, id',
    [scribeId],
  )
  const orders = (await q.query('SELECT * FROM orders WHERE scribe_id = $1 ORDER BY seq', [scribeId])).map(orderFromRow)

  const payouts: Array<{ id: string; orderId: string; amount: number; status: 'In Escrow' | 'Released' | 'Transferred'; date: string }> = []
  for (const o of orders) {
    const rec = escrow.find((e) => e.orderId === o.id)
    if (rec?.isReleased) payouts.push({ id: `P-${o.id}`, orderId: o.id, amount: o.scribePayout, status: 'Released', date: rec.releaseDueAt.toISOString() })
    else if (rec?.disputeOutcome === 'REFUNDED_TO_CUSTOMER' || o.status === 'Cancelled') continue
    else if (['Accepted', 'Writing', 'Dispatched', 'Delivered', 'Disputed'].includes(o.status)) {
      payouts.push({ id: `P-${o.id}`, orderId: o.id, amount: o.scribePayout, status: 'In Escrow', date: o.timeline.at(-1)?.timestamp ?? o.createdAt })
    }
  }
  for (const w of paidOut) payouts.push({ id: w.id, orderId: '—', amount: w.amount, status: 'Transferred', date: w.created_at.toISOString() })

  const releasedTotal = escrow.filter((e) => e.isReleased).reduce((n, e) => n + e.amount, 0)
  const withdrawn = paidOut.reduce((n, w) => n + w.amount, 0)
  return {
    payouts,
    walletBalance: releasedTotal - withdrawn,
    pendingEscrow: payouts.filter((p) => p.status === 'In Escrow').reduce((n, p) => n + p.amount, 0),
    lifetimeEarnings: releasedTotal,
  }
}

async function scribeView(q: Queryable, phoneNumber: string) {
  const id = scribeIdFor(phoneNumber)
  const rec = await logi.getScribe(q, id)
  const [{ count }] = await q.query<{ count: string }>(
    `SELECT count(*) FROM orders WHERE scribe_id = $1 AND status IN ('Delivered','Closed')`,
    [id],
  )
  return {
    profile: {
      id,
      phone: phoneNumber,
      registered: !!rec,
      name: rec?.name ?? '',
      college: rec?.college ?? '',
      upiVpa: rec?.upiVpa ?? '',
      specialties: rec?.specialties ?? [],
      sampleText: rec?.sampleCardText ?? '',
      sampleImageUrl: rec?.handwritingSampleUrl || undefined,
      isApproved: !!rec?.isApproved,
      isSuspended: !!rec?.isSuspended,
      totalOrders: Number(count),
    },
    ...(await walletOf(q, id)),
  }
}

// ── App factory (tests build a fresh app so rate limits start clean) ─────────

export function createApp(db: Db) {
  const app = express()

  // OTP codes and lockouts are short-lived and kept in this process. With several API
  // instances, move them to a shared store (see DEPLOYMENT.md).
  const activeOtps = new Map<string, { otp: string; expiresAt: number }>()
  const otpAttempts = new AttemptLimiter(5, FIFTEEN_MIN)
  const deliveryAttempts = new AttemptLimiter(5, FIFTEEN_MIN)

  const hops = process.env.TRUST_PROXY
  if (hops) app.set('trust proxy', /^\d+$/.test(hops) ? Number(hops) : hops)

  app.use(helmet())
  app.use(cors({ origin: corsOrigins() }))
  app.use(express.json({ limit: '1mb' }))

  const limit = (max: number) =>
    rateLimit({
      windowMs: FIFTEEN_MIN,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please wait a few minutes and try again.' },
    })
  const general = limit(300)
  const otpSendLimit = limit(5)
  const otpVerifyLimit = limit(20)
  const sensitiveLimit = limit(Number(process.env.SENSITIVE_LIMIT) || 60)
  app.use('/api', general)

  // ── 1. Auth ────────────────────────────────────────────────────────────────

  app.post('/api/auth/otp/send', otpSendLimit, (req, res) => {
    const ph = phone(bodyOf(req).phone)
    // No SMS provider is wired up yet. Until one is, codes are only issued in demo mode,
    // and are returned in the response. Production must not hand codes to the caller.
    if (!demoOtpEnabled()) return res.status(503).json({ error: 'SMS delivery is not configured' })

    if (activeOtps.size > 5000) {
      for (const [k, v] of activeOtps) if (v.expiresAt < Date.now()) activeOtps.delete(k)
    }
    const otp = randomDigits(6)
    activeOtps.set(ph, { otp, expiresAt: Date.now() + 5 * 60 * 1000 })
    return res.json({ success: true, message: `OTP sent to ${ph}.`, expiresInSeconds: 300, devOtp: otp })
  })

  app.post('/api/auth/otp/verify', otpVerifyLimit, (req, res) => {
    const b = bodyOf(req)
    const ph = phone(b.phone)
    const otp = str(b.otp, 'otp', { min: 6, max: 6 })
    const role = oneOf<Role>(b.requestedRole ?? 'customer', 'requestedRole', ['customer', 'scribe', 'admin'])
    if (!/^\d{6}$/.test(otp)) throw new ValidationError('otp must be 6 digits')
    if (role === 'admin' && !adminPhones().has(ph)) throw forbid('This number cannot sign in as admin')

    if (otpAttempts.lockedForMs(ph) > 0) {
      return res.status(429).json({ error: 'Too many wrong codes. Try again in 15 minutes.' })
    }
    const session = activeOtps.get(ph)
    if (!session || Date.now() > session.expiresAt || !safeEqual(session.otp, otp)) {
      otpAttempts.fail(ph)
      if (otpAttempts.lockedForMs(ph) > 0) activeOtps.delete(ph)
      return res.status(401).json({ error: 'Invalid or expired OTP' })
    }

    activeOtps.delete(ph)
    otpAttempts.clear(ph)
    return res.json({
      success: true,
      token: signSession({ phone: ph, role }),
      user: { phone: ph, role, ...(role === 'scribe' ? { scribeId: scribeIdFor(ph) } : {}) },
    })
  })

  // Approved scribes a customer can choose from. Contact details never leave the server.
  app.get('/api/scribes', async (_req, res) => {
    const all = await logi.getAllScribes(db)
    const busy = new Set((await db.query<{ scribe_id: string }>(`SELECT DISTINCT scribe_id FROM orders WHERE status = 'Writing'`)).map((r) => r.scribe_id))
    const done = await db.query<{ scribe_id: string; n: string }>(
      `SELECT scribe_id, count(*) AS n FROM orders WHERE status IN ('Delivered','Closed') GROUP BY scribe_id`,
    )
    const scribes = all
      .filter((x) => x.isApproved && !x.isSuspended)
      .map((x) => ({
        id: x.scribeId,
        name: x.name,
        college: x.college,
        specialties: x.specialties ?? [],
        sample: x.sampleCardText,
        sampleImageUrl: x.handwritingSampleUrl || undefined,
        completedOrders: Number(done.find((d) => d.scribe_id === x.scribeId)?.n ?? 0),
        available: !busy.has(x.scribeId),
      }))
    res.json({ success: true, scribes })
  })

  // ── 2. Pricing and text checks (public) ────────────────────────────────────

  app.post('/api/pricing/quote', (req, res) => {
    const b = bodyOf(req)
    const quote = calculateQuote({
      words: int(b.words, 'words', 0, 200_000),
      simpleDrawings: optInt(b.simpleDrawings, 'simpleDrawings', 0, 100),
      complexDrawings: optInt(b.complexDrawings, 'complexDrawings', 0, 100),
      graphs: optInt(b.graphs, 'graphs', 0, 100),
      customTemplate: b.customTemplate === undefined ? false : bool(b.customTemplate, 'customTemplate'),
    })
    return res.json({ success: true, quote })
  })

  app.post('/api/text/analyze', (req, res) => {
    const rawText = str(bodyOf(req).rawText, 'rawText', { max: 300_000 })
    const clean = sanitizeText(rawText)
    const cover = checkCoverPage(clean)
    return res.json({
      success: true,
      words: countWords(clean),
      coverPageWarning: cover.warning,
      detectedKeywords: cover.matches,
    })
  })

  // ── 3. Payments (UPI test mode) ────────────────────────────────────────────

  async function loadPayment(q: Queryable, paymentId: string, s: Session, lock = false) {
    const rows = await q.query<{ intent: UpiPaymentIntent }>(`SELECT intent FROM payments WHERE payment_id = $1${lock ? ' FOR UPDATE' : ''}`, [paymentId])
    const intent = rows[0]?.intent
    const order = intent && (await fetchOrder(q, intent.orderId, lock))
    if (!intent || !order || !canView(order, s)) throw notFound('Payment not found')
    return { intent, order }
  }

  app.post('/api/payment/upi/initiate', sensitiveLimit, requireAuth('customer', 'admin'), async (req, res) => {
    if (!testPaymentsAllowed()) return res.status(503).json({ error: 'UPI gateway is not configured' })
    const b = bodyOf(req)
    const orderId = idLike(b.orderId, 'orderId')
    const amount = rupees(b.amount)
    const payer = b.payerVpa === undefined ? 'student@upi' : upiId(b.payerVpa)

    const order = await fetchOrder(db, orderId)
    if (!order || !canView(order, sessionOf(res))) throw notFound('Order not found')
    // The server decides the price, so a client cannot pay less than the order total.
    if (Math.abs(amount - order.customerTotal) > 0.001) throw new HttpError(400, 'Amount does not match the order total')
    if (order.status !== 'Draft') throw new HttpError(409, 'This order has already been paid')

    const intent = createUpiPaymentIntent(orderId, amount, payer)
    await db.query('INSERT INTO payments (payment_id, order_id, intent) VALUES ($1,$2,$3::jsonb)', [intent.paymentId, orderId, JSON.stringify(intent)])
    return res.json({ success: true, payment: intent })
  })

  app.post('/api/payment/upi/verify', sensitiveLimit, requireAuth('customer', 'admin'), async (req, res) => {
    if (!testPaymentsAllowed()) return res.status(503).json({ error: 'UPI gateway is not configured' })
    const b = bodyOf(req)
    const paymentId = str(b.paymentId, 'paymentId', { max: 60 })
    const forceSuccess = b.forceSuccess === undefined ? true : bool(b.forceSuccess, 'forceSuccess')

    const out = await db.tx(async (q) => {
      const { intent, order } = await loadPayment(q, paymentId, sessionOf(res), true)
      // Asking twice never pays twice.
      if (intent.status === 'SUCCESS') return { success: true, payment: intent, orderStatus: order.status }
      if (forceSuccess && intent.amount !== order.customerTotal) throw new HttpError(400, 'Amount does not match the order total')

      intent.status = forceSuccess ? 'SUCCESS' : 'FAILED'
      await q.query('UPDATE payments SET intent = $2::jsonb WHERE payment_id = $1', [paymentId, JSON.stringify(intent)])
      if (forceSuccess && order.status === 'Draft') await applyTransition(q, order, 'Paid', 'Escrow payment locked in test gateway.')
      return { success: forceSuccess, payment: intent, orderStatus: order.status }
    })
    return res.json(out)
  })

  app.get('/api/payment/:id', requireAuth('customer', 'admin'), async (req, res) => {
    const { intent } = await loadPayment(db, str(req.params.id, 'payment id', { max: 60 }), sessionOf(res))
    return res.json({ success: true, payment: intent })
  })

  // ── 4. Orders and the state machine ────────────────────────────────────────

  app.get('/api/orders', requireAuth(), async (_req, res) => {
    const s = sessionOf(res)
    const me = scribeIdFor(s.phone)
    let rows: any[]
    if (s.role === 'admin') {
      rows = await db.query('SELECT * FROM orders ORDER BY seq DESC')
    } else if (s.role === 'customer') {
      rows = await db.query('SELECT * FROM orders WHERE customer_phone = $1 ORDER BY seq DESC', [s.phone])
    } else {
      const open = (await scribeCanWork(db, s.phone))
        ? `OR (status IN ('Paid','Reassigned') AND (preferred_scribe_id IS NULL OR preferred_scribe_id = $1))`
        : ''
      rows = await db.query(`SELECT * FROM orders WHERE scribe_id = $1 ${open} ORDER BY seq DESC`, [me])
    }
    res.json({ success: true, orders: rows.map(orderFromRow).map((o) => publicOrder(o, s)) })
  })

  app.get('/api/orders/:id', requireAuth(), async (req, res) => {
    const order = await loadVisible(db, idLike(req.params.id, 'order id'), sessionOf(res))
    res.json({ success: true, order: publicOrder(order, sessionOf(res)) })
  })

  app.post('/api/orders/create', requireAuth('customer', 'admin'), async (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const words = int(b.words, 'words', 1, 200_000)
    const extras = {
      simpleDrawings: optInt(b.simpleDrawings, 'simpleDrawings', 0, 100),
      complexDrawings: optInt(b.complexDrawings, 'complexDrawings', 0, 100),
      graphs: optInt(b.graphs, 'graphs', 0, 100),
      customTemplate: b.customTemplate === undefined ? false : bool(b.customTemplate, 'customTemplate'),
    }
    if (!meetsMinimum(words)) throw new ValidationError(MIN_ORDER_MESSAGE)
    const q = calculateQuote({ words, ...extras })
    const title = optStr(b.title, 'title', 120) ?? 'Manuscript Order'
    const subject = optStr(b.subject, 'subject', 60) ?? 'General'
    const penStyle = optStr(b.penStyle, 'penStyle', 40) ?? 'Ballpoint · Blue'
    const preferred = optStr(b.preferredScribeId, 'preferredScribeId', 40)
    if (preferred) {
      idLike(preferred, 'preferredScribeId')
      const rec = await logi.getScribe(db, preferred)
      if (!rec || !rec.isApproved || rec.isSuspended) throw new ValidationError('That scribe is not available')
    }

    const order: OrderDoc = {
      id: await newOrderId(db),
      customerPhone: s.phone,
      title,
      subject,
      status: 'Draft',
      customerTotal: q.customerTotal,
      scribePayout: q.scribeTotal,
      pages: q.pages,
      words,
      deliveryOtp: randomDigits(6),
      addons: addonLabels(extras, q.pages),
      penStyle,
      preferredScribeId: preferred,
      createdAt: new Date().toISOString(),
      finalDeadline: computeDeadlines(q.pages).formattedFinalDeadline,
      timeline: [{ status: 'Draft', timestamp: new Date().toISOString(), note: 'Order created. Waiting for payment.' }],
    }
    await insertOrder(db, order)
    return res.status(201).json({ success: true, order: publicOrder(order, s) })
  })

  app.post('/api/orders/:id/transition', requireAuth(), async (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const id = idLike(req.params.id, 'order id')
    const next = oneOf<OrderStateEnum>(b.nextStatus, 'nextStatus', STATES)
    const note = optStr(b.note, 'note', 300)
    const me = scribeIdFor(s.phone)
    const adminScribe = s.role === 'admin' && b.scribeId !== undefined ? idLike(b.scribeId, 'scribeId') : undefined

    const out = await db.tx(async (q) => {
      const order = await loadVisible(q, id, s, true)

      // Who may move an order where.
      if (s.role === 'scribe') {
        if (!SCRIBE_TARGETS.has(next)) throw forbid()
        if (next === 'Accepted' ? order.scribeId && order.scribeId !== me : order.scribeId !== me) {
          throw forbid('Only the assigned scribe can do this')
        }
        if (next === 'Accepted') {
          if (!(await scribeCanWork(q, s.phone))) throw forbid('Your handwriting card has not been approved yet')
          if (order.preferredScribeId && order.preferredScribeId !== me) throw forbid('This order was requested for another scribe')
        }
      } else if (s.role === 'customer') {
        if (!CUSTOMER_TARGETS.has(next)) throw forbid()
      }

      const check = validateTransition(order.status, next)
      if (!check.success) throw new HttpError(400, check.error ?? 'That change is not allowed')

      // Admins may assign a scribe by hand. Scribes assign themselves when they accept.
      let scribeId = order.scribeId
      if (s.role === 'scribe' && next === 'Accepted') scribeId = me
      if (adminScribe) scribeId = adminScribe
      if ((next === 'Writing' || next === 'Delivered') && !scribeId) throw new HttpError(400, 'Order has no assigned scribe yet')

      order.scribeId = scribeId
      order.scribeName = scribeId ? (await logi.getScribe(q, scribeId))?.name ?? scribeId : undefined
      await applyTransition(q, order, next, note ?? check.auditLog)
      return { order: publicOrder(order, s), audit: check.auditLog }
    })
    return res.json({ success: true, ...out })
  })

  // ── 5. Rush check-ins and strikes ──────────────────────────────────────────

  app.post('/api/orders/:id/checkin', requireAuth('scribe', 'admin'), async (req, res) => {
    const s = sessionOf(res)
    const id = idLike(req.params.id, 'order id')
    const note = optStr(bodyOf(req).note, 'note', 300) ?? 'Hourly rush check-in verified. Timer reset.'

    const out = await db.tx(async (q) => {
      const order = await loadVisible(q, id, s, true)
      if (s.role === 'scribe' && order.scribeId !== scribeIdFor(s.phone)) throw forbid('Only the assigned scribe can check in')
      if (order.status !== 'Writing') throw new HttpError(400, 'Check-in only permitted while in Writing status')

      const nextDue = computeNextCheckInDeadline()
      order.nextCheckInDue = nextDue.toISOString()
      await sched.recordCheckIn(q, order.id, nextDue)
      order.timeline.push({ status: 'Writing Check-in', timestamp: new Date().toISOString(), note })
      await saveOrder(q, order)
      return { nextCheckInDue: nextDue.toISOString(), order: publicOrder(order, s) }
    })
    return res.json({ success: true, ...out })
  })

  app.get('/api/scribes/:id/strikes', requireAuth('scribe', 'admin'), async (req, res) => {
    const s = sessionOf(res)
    const id = idLike(req.params.id, 'scribe id')
    if (s.role === 'scribe' && id !== scribeIdFor(s.phone)) throw forbid()
    return res.json({ success: true, strikes: await sched.getScribeStrikeInfo(db, id) })
  })

  // ── 5b. Scribe profile, wallet and payouts ─────────────────────────────────

  app.get('/api/scribe/me', requireAuth('scribe'), async (_req, res) => {
    res.json({ success: true, ...(await scribeView(db, sessionOf(res).phone)) })
  })

  app.put('/api/scribe/me', requireAuth('scribe'), async (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const specialties = Array.isArray(b.specialties) ? b.specialties : []
    if (specialties.length > 12) throw new ValidationError('specialties has too many entries')
    const sampleImage = optStr(b.sampleImageUrl, 'sampleImageUrl', 80)
    if (sampleImage && !(SAMPLE_PATH.test(sampleImage) && findUpload(sampleImage.slice('/api/samples/'.length), IMAGE_TYPES))) {
      throw new ValidationError('sampleImageUrl must be an uploaded sample')
    }
    const profile = {
      scribeId: scribeIdFor(s.phone),
      phone: s.phone,
      name: str(b.name, 'name', { max: 60 }),
      college: str(b.college, 'college', { max: 100 }),
      sampleCardText: str(b.sampleText, 'sampleText', { min: 10, max: 600 }),
      upiVpa: upiId(b.upiVpa, 'upiVpa'),
      specialties: specialties.map((x) => str(x, 'specialty', { max: 40 })),
      sampleImageUrl: sampleImage,
    }
    await db.tx((q) => logi.upsertScribe(q, profile))
    res.json({ success: true, ...(await scribeView(db, s.phone)) })
  })

  app.post('/api/scribe/withdraw', sensitiveLimit, requireAuth('scribe'), async (_req, res) => {
    const s = sessionOf(res)
    const id = scribeIdFor(s.phone)
    const out = await db.tx(async (q) => {
      // Lock the scribe's row so two withdrawals at once cannot both take the same balance.
      await q.query('SELECT 1 FROM scribes WHERE scribe_id = $1 FOR UPDATE', [id])
      const rec = await logi.getScribe(q, id)
      if (!rec || !rec.upiVpa) throw new HttpError(400, 'Add your UPI ID in your profile first')
      if (rec.isSuspended) throw forbid('Your account is suspended')
      const { walletBalance } = await walletOf(q, id)
      if (walletBalance <= 0) throw new HttpError(400, 'Nothing to withdraw yet')
      // No payout provider is connected: this records the transfer so balances stay correct.
      await q.query('INSERT INTO withdrawals (id, scribe_id, amount, upi_vpa) VALUES ($1,$2,$3,$4)', [`TX-${randomDigits(6)}`, id, walletBalance, rec.upiVpa])
      return walletBalance
    })
    res.json({ success: true, withdrawn: out, ...(await scribeView(db, s.phone)) })
  })

  // ── 5c. Uploads (evidence videos, handwriting samples) ─────────────────────

  const uploadName = (req: Request) => {
    const raw = req.headers['x-file-name']
    return typeof raw === 'string' ? decodeURIComponent(raw).slice(0, 120) : 'file'
  }

  app.post(
    '/api/uploads/video',
    sensitiveLimit,
    requireAuth('customer', 'admin'),
    express.raw({ type: 'application/octet-stream', limit: '100mb' }),
    (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      const verdict = validateUpload({ name: uploadName(req), size: bytes.length }, bytes, 'video')
      if (!verdict.ok) return res.status(400).json({ error: verdict.error })
      return res.status(201).json({ success: true, url: `/api/media/${storeUpload(bytes, 'mp4')}` })
    },
  )

  // Handwriting sample photos are shown to customers, so they are served without sign-in.
  app.post(
    '/api/uploads/sample',
    sensitiveLimit,
    requireAuth('scribe'),
    express.raw({ type: 'application/octet-stream', limit: '9mb' }),
    (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      const verdict = validateUpload({ name: uploadName(req), size: bytes.length }, bytes, 'image')
      if (!verdict.ok) return res.status(400).json({ error: verdict.error })
      return res.status(201).json({ success: true, url: `/api/samples/${storeUpload(bytes, verdict.type)}` })
    },
  )

  app.get('/api/samples/:id', (req, res) => {
    const id = String(req.params.id)
    const found = /^[a-f0-9]{32}$/.test(id) ? findUpload(id, IMAGE_TYPES) : undefined
    if (!found) return res.status(404).json({ error: 'Not found' })
    res.setHeader('Content-Type', `image/${found.type}`)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    return fs.createReadStream(found.file).pipe(res)
  })

  app.get('/api/media/:id', requireAuth(), (req, res) => {
    const id = String(req.params.id)
    const found = /^[a-f0-9]{32}$/.test(id) ? findUpload(id, ['mp4']) : undefined
    if (!found) return res.status(404).json({ error: 'Not found' })
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Cache-Control', 'private, max-age=300')
    return fs.createReadStream(found.file).pipe(res)
  })

  // ── 6. Scheduled jobs (platform cron or admin) ─────────────────────────────

  app.post('/api/cron/trigger-jobs', requireAdminOrCron, async (req, res) => {
    const given = bodyOf(req).simulatedTimestamp
    // Simulating the clock would release escrow early, so it only works outside production.
    if (given !== undefined && isProduction()) return res.status(400).json({ error: 'simulatedTimestamp is not allowed in production' })
    const now = given === undefined ? new Date() : new Date(str(given, 'simulatedTimestamp', { max: 40 }))
    if (Number.isNaN(now.getTime())) throw new ValidationError('simulatedTimestamp is not a valid date')

    const { escrowReleased, rushResults } = await runScheduledJobs(db, now)
    return res.json({
      success: true,
      simulatedTime: now.toISOString(),
      escrowReleased,
      rushResults,
      auditLogs: await sched.getAuditLogs(db, 10),
    })
  })

  // ── 7. Courier logistics ───────────────────────────────────────────────────

  app.post('/api/logistics/dispatch', requireAuth('admin', 'scribe'), async (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const orderId = idLike(b.orderId, 'orderId')
    const partner = b.partner === undefined ? undefined : oneOf(b.partner, 'partner', ['Borzo', 'Porter'] as const)
    const dropGate = optStr(b.dropGate, 'dropGate', 120)
    const pickup = optStr(b.pickupAddress, 'pickupAddress', 120)

    const out = await db.tx(async (q) => {
      const order = await fetchOrder(q, orderId, true)
      if (!order) throw notFound('Order not found')
      if (s.role === 'scribe' && order.scribeId !== scribeIdFor(s.phone)) throw forbid('Only the assigned scribe can dispatch')

      const task = await logi.createCourierDispatch(q, orderId, dropGate, pickup, partner, order.deliveryOtp, order.customerPhone)
      if (order.status === 'Writing') await applyTransition(q, order, 'Dispatched', `Handed to ${task.courierPartner}. Tracking ${task.trackingId}.`)
      // The code goes to the customer only. Whoever dispatches must never see it.
      const { deliveryOtp: _otp, ...safeTask } = task
      return { task: safeTask, order: publicOrder(order, s) }
    })
    return res.json({ success: true, ...out })
  })

  app.post('/api/logistics/confirm-delivery', sensitiveLimit, requireAuth('customer', 'admin', 'scribe'), async (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const orderId = idLike(b.orderId, 'orderId')
    const otp = str(b.deliveryOtp, 'deliveryOtp', { min: 4, max: 8 })
    const photo = b.gateDropPhotoUrl === undefined ? undefined : mediaUrl(b.gateDropPhotoUrl, 'gateDropPhotoUrl')

    if (deliveryAttempts.lockedForMs(orderId) > 0) {
      return res.status(429).json({ error: 'Too many wrong codes. Try again in 15 minutes.' })
    }

    const out = await db.tx(async (q) => {
      const order = await loadVisible(q, orderId, s, true)
      if (s.role === 'scribe' && order.scribeId !== scribeIdFor(s.phone)) throw forbid('Only the assigned scribe can confirm delivery')

      const result = await logi.confirmGateDelivery(q, orderId, otp, photo, order.customerPhone)
      if (!result.success) return { ok: false as const, error: result.error ?? 'Delivery could not be confirmed' }

      // Handover is acceptance: this starts the 24-hour payout clock.
      if (order.status === 'Dispatched' && order.scribeId) await applyTransition(q, order, 'Delivered', 'Delivery code confirmed at the gate.')
      const { deliveryOtp: _otp, ...safeTask } = result.task!
      return { ok: true as const, task: safeTask, order: publicOrder(order, s) }
    })

    if (!out.ok) {
      if (out.error.includes('Invalid Delivery OTP')) deliveryAttempts.fail(orderId)
      return res.status(400).json({ error: out.error })
    }
    deliveryAttempts.clear(orderId)
    return res.json({ success: true, task: out.task, order: out.order })
  })

  // ── 8. Disputes and admin ──────────────────────────────────────────────────

  app.post('/api/disputes/file', sensitiveLimit, requireAuth('customer', 'admin'), async (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const orderId = idLike(b.orderId, 'orderId')
    const reason = oneOf('reason' in b ? b.reason : 'MISSING_PAGES', 'reason', [
      'ILLEGIBLE_HANDWRITING', 'MISSING_PAGES', 'DAMAGED_ENVELOPE', 'INCORRECT_DIAGRAMS', 'OTHER',
    ] as const)
    const video = evidenceUrl(b.unboxingVideoUrl, 'unboxingVideoUrl')
    const notes = optStr(b.customerNotes, 'customerNotes', 1000) ?? ''
    const name = optStr(b.customerName, 'customerName', 80)

    const dispute = await db.tx(async (q) => {
      const order = await loadVisible(q, orderId, s, true)
      if (order.status !== 'Delivered') throw new HttpError(400, 'A dispute can only be filed on a delivered order')
      const open = await q.query(`SELECT 1 FROM disputes WHERE order_id = $1 AND status = 'PENDING_REVIEW'`, [orderId])
      if (open.length) throw new HttpError(409, 'A dispute is already open for this order')

      // Scribe and amount come from the order, never from the client.
      const d = await logi.fileDispute(q, orderId, reason, video, notes, name, order.scribeId, order.customerTotal, order.scribeName)
      await sched.freezeEscrow(q, orderId)
      await applyTransition(q, order, 'Disputed', `Dispute ${d.id} opened. Escrow frozen.`)
      return d
    })
    return res.status(201).json({ success: true, dispute })
  })

  app.get('/api/admin/disputes', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, disputes: await logi.getAllDisputes(db) })
  })

  app.post('/api/admin/disputes/:id/resolve', requireAuth('admin'), async (req, res) => {
    const b = bodyOf(req)
    const id = idLike(req.params.id, 'dispute id')
    const decision = oneOf('decision' in b ? b.decision : undefined, 'decision', [
      'REFUNDED_TO_CUSTOMER', 'RELEASED_TO_SCRIBE', 'SPLIT',
    ] as const)
    const adminNotes = optStr(b.adminNotes, 'adminNotes', 500) ?? 'Resolved'

    const resolved = await db.tx(async (q) => {
      const existing = (await logi.getAllDisputes(q)).find((d) => d.id === id)
      if (!existing) throw notFound('Dispute record not found')
      const order = await fetchOrder(q, existing.orderId, true)
      if (existing.status !== 'PENDING_REVIEW') throw new HttpError(409, 'This dispute is already resolved')

      const r = await logi.resolveDispute(q, id, decision, adminNotes)
      await sched.settleEscrow(q, existing.orderId, decision)
      if (order && validateTransition(order.status, 'Closed').success) {
        await applyTransition(q, order, 'Closed', `Dispute ${id} ruled ${decision}.`)
      }
      return r
    })
    return res.json({ success: true, dispute: resolved })
  })

  app.get('/api/admin/scribes', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, scribes: await logi.getAllScribes(db) })
  })

  app.post('/api/admin/scribes/:id/verify', requireAuth('admin'), async (req, res) => {
    const id = idLike(req.params.id, 'scribe id')
    const approved = bool(bodyOf(req).isApproved, 'isApproved')
    if (!(await logi.getScribe(db, id))) throw notFound('Scribe not found')
    return res.json({ success: true, scribe: await logi.verifyScribeCard(db, id, approved) })
  })

  app.post('/api/admin/scribes/:id/strikes', requireAuth('admin'), async (req, res) => {
    const id = idLike(req.params.id, 'scribe id')
    const delta = int(bodyOf(req).delta ?? 1, 'delta', -5, 5)
    if (delta === 0) throw new ValidationError('delta cannot be 0')
    const scribe = await db.tx(async (q) => {
      if (!(await logi.getScribe(q, id))) throw notFound('Scribe not found')
      return logi.manageScribeStrike(q, id, delta)
    })
    return res.json({ success: true, scribe })
  })

  app.get('/api/admin/notifications', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, notifications: await logi.getNotificationLogs(db) })
  })

  app.get('/api/health', async (_req, res) => {
    let database: 'ok' | 'down' = 'ok'
    try {
      await db.query('SELECT 1')
    } catch {
      database = 'down'
    }
    res.status(database === 'ok' ? 200 : 503).json({
      service: 'ScribeLink Core API',
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      storage: db.kind,
      phase: 9,
      production: isProduction(),
      timestamp: new Date().toISOString(),
    })
  })

  // ── Fallbacks ──────────────────────────────────────────────────────────────

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message })
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    const status = (err as { status?: number })?.status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return res.status(status).json({ error: status === 413 ? 'Request is too large' : 'Invalid request' })
    }
    console.error('[api] unhandled error', err)
    return res.status(500).json({ error: 'Internal server error' })
  })

  return app
}

function corsOrigins(): string[] | false {
  const list = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (list.length > 0) return list
  return isProduction() ? false : ['http://localhost:5173', 'http://localhost:4173']
}

// ── Start-up ─────────────────────────────────────────────────────────────────

async function main() {
  assertProductionConfig()
  if (isProduction() && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production (the embedded database is for development only)')
  }
  const db = await createDb({ url: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR })
  if (process.env.SEED_DEMO === 'true') await logi.seedDemoData(db)

  createApp(db).listen(PORT, () => {
    console.log(`[ScribeLink] API listening on port ${PORT} (${db.kind})`)
  })
  // Escrow and the rush monitor must not depend on someone calling the cron endpoint.
  setInterval(() => {
    runScheduledJobs(db, new Date()).catch((e) => console.error('[jobs] failed', e))
  }, 60_000).unref()
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
