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
import { MIN_ORDER_MESSAGE, calculateQuote, checkCoverPage, checkConfidentialBlocklist, meetsMinimum, countWords, sanitizeText } from '../shared/rules'
import { POLICY_VERSION } from '../shared/legal'
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
import * as addr from './addresses'
import * as courier from './courier'
import * as notify from './notify'
import * as feedback from './feedback'
import type { CourierTask } from '../shared/logisticsDisputes'
import * as files from './files'
import { renderInvoice, sellerFromEnv } from './invoice'
import * as rzp from './razorpay'
import * as refunds from './refunds'
import { REFUND_POLICY, customerCanCancel, type RefundReason } from '../shared/refunds'
import * as sched from './scheduler'
import * as logi from './logisticsService'
import * as adminOps from './adminOps'
import * as legal from './legal'
import * as referrals from './referrals'
import * as pilot from './pilot'
import { createOtpStore } from './redisStore'
import { s3ConfigFromEnv } from './s3Store'
import { logEvent, reportError } from './telemetry'
import {
  calcTds, encryptPan, panLast4, recordTds, validatePan, ytdGross,
  issuePayout, monthlyStatement, razorpayXConfig,
} from './payouts'
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
  /** The customer's notes file, if uploaded. Only the owner, the assigned scribe and admins can read it. */
  notesFileId?: string
  /** Where the finished pages are delivered. A copy taken when the order was placed. */
  dropGate?: addr.Address
  addons: string[]
  penStyle: string
  /** If set, only this scribe sees the order in their pool. */
  preferredScribeId?: string
  createdAt: string
  intakeDeadline?: string
  nextCheckInDue?: string
  finalDeadline: string
  timeline: Array<{ status: string; timestamp: string; note: string }>
  /** Referral credit taken off the customer's total. The scribe's payout is not affected. */
  discount: number
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
  notesFileId: r.notes_file_id ?? undefined,
  dropGate: r.drop_gate ?? undefined,
  addons: r.addons,
  penStyle: r.pen_style,
  preferredScribeId: r.preferred_scribe_id ?? undefined,
  createdAt: iso(r.created_at)!,
  intakeDeadline: iso(r.intake_deadline),
  nextCheckInDue: iso(r.next_check_in_due),
  finalDeadline: r.final_deadline,
  timeline: r.timeline,
  discount: Number(r.discount ?? 0),
})

/** Reads an order. With lock, the row stays locked until the surrounding transaction ends. */
async function fetchOrder(q: Queryable, id: string, lock = false): Promise<OrderDoc | undefined> {
  const rows = await q.query(`SELECT * FROM orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? orderFromRow(rows[0]) : undefined
}

async function insertOrder(q: Queryable, o: OrderDoc): Promise<void> {
  await q.query(
    `INSERT INTO orders (id, customer_phone, title, subject, status, customer_total, scribe_payout, preferred_scribe_id,
       pages, words, delivery_otp, addons, pen_style, final_deadline, timeline, created_at, notes_file_id, drop_gate, discount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16,$17,$18::jsonb,$19)`,
    [o.id, o.customerPhone ?? null, o.title, o.subject, o.status, o.customerTotal, o.scribePayout, o.preferredScribeId ?? null,
      o.pages, o.words, o.deliveryOtp, JSON.stringify(o.addons), o.penStyle, o.finalDeadline, JSON.stringify(o.timeline), o.createdAt, o.notesFileId ?? null, o.dropGate ? JSON.stringify(o.dropGate) : null, o.discount],
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

const store = files.diskStore(UPLOAD_DIR)

/** Stored files are named <id>.<detected type>, so the type never comes from the client. */
const findUpload = (id: string, types: readonly string[]) => store.find(id, types)

/** Saves the bytes and records who owns the file and when it expires. */
async function storeUpload(q: Queryable, bytes: Buffer, type: string, kind: files.FileKind, ownerPhone: string): Promise<string> {
  const id = randomToken(16).toLowerCase()
  await store.put(id, type, bytes)
  await files.registerFile(q, { id, kind, type, size: bytes.length, ownerPhone })
  return id
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const bodyOf = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}

/** Test mode refunds are final at once. A real gateway confirms them later by webhook. */
const refundsAreInstant = () => rzp.paymentProvider() !== 'razorpay'

const demoOtpEnabled = () => !isProduction() || process.env.DEMO_OTP === 'true'
const testPaymentsAllowed = () => rzp.paymentProvider() === 'test' && (!isProduction() || process.env.ALLOW_TEST_PAYMENTS === 'true')

const ownsOrder = (o: OrderDoc, s: Session) => o.customerPhone !== undefined && o.customerPhone === s.phone

/** Customers see only their own orders. Scribes and admins see any (scribes only see IDs, never owners). */
const canView = (o: OrderDoc, s: Session) => s.role !== 'customer' || ownsOrder(o, s)

/** Strips the delivery code unless the viewer is the owning customer or an admin. */
function publicOrder(o: OrderDoc, s: Session): Omit<OrderDoc, 'customerPhone' | 'deliveryOtp'> & { deliveryOtp?: string } {
  const { customerPhone: _owner, deliveryOtp, dropGate, ...rest } = o
  if (s.role === 'admin' || ownsOrder(o, s)) return { ...rest, dropGate, deliveryOtp }
  // The scribe learns only where the pages go, never who the customer is.
  const place = dropGate && { label: dropGate.label, college: dropGate.college, line: dropGate.line, landmark: dropGate.landmark, pincode: dropGate.pincode }
  return { ...rest, ...(place ? { dropGate: place as addr.Address } : {}) }
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
async function applyTransition(q: Queryable, order: OrderDoc, next: OrderStateEnum, note: string, refundReason: RefundReason = 'ADMIN_CANCELLED'): Promise<void> {
  order.status = next
  if (next === 'Cancelled') {
    const refund = await refunds.recordRefund(q, order, refundReason, refundsAreInstant())
    if (refund) await sched.audit(q, `[REFUND] ₹${refund.amount} for ${order.id} (${refund.reason}).`)
    await referrals.releaseCredit(q, order.id)
  }
  if (next === 'Closed' || next === 'Cancelled') await files.startRetention(q, order.id)
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
  if (next === 'Delivered') {
    const referrer = await referrals.rewardReferrer(q, order.customerPhone, order.id)
    if (referrer) await sched.audit(q, `[REFERRAL] ₹${referrals.REFERRAL_CREDIT} credit for the referrer of ${order.id}.`)
  }

  order.timeline.push({ status: next, timestamp: new Date().toISOString(), note })
  await saveOrder(q, order)
  await notify.notifyOrderEvent(q, order, next)
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
    // A paid order nobody takes is cancelled and refunded, so the customer is never left waiting.
    const waiting = (await q.query(`SELECT * FROM orders WHERE status IN ('Paid','Reassigned')`)).map(orderFromRow)
    let unclaimedRefunded = 0
    for (const o of waiting) {
      const since = new Date(o.timeline.at(-1)?.timestamp ?? o.createdAt).getTime()
      if (now.getTime() - since < REFUND_POLICY.unacceptedHours * 3_600_000) continue
      const locked = await fetchOrder(q, o.id, true)
      if (!locked || !['Paid', 'Reassigned'].includes(locked.status)) continue
      await applyTransition(q, locked, 'Cancelled', `No scribe accepted within ${REFUND_POLICY.unacceptedHours} hours. Refunded in full.`, 'NO_SCRIBE')
      unclaimedRefunded++
    }
    const filesDeleted = await files.sweepFiles(q, store, now)
    return { escrowReleased, rushResults, filesDeleted, unclaimedRefunded }
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
  const otpStore = createOtpStore()
  const otpAttempts = new AttemptLimiter(5, FIFTEEN_MIN)
  const deliveryAttempts = new AttemptLimiter(5, FIFTEEN_MIN)
  const pickupAttempts = new AttemptLimiter(5, FIFTEEN_MIN)

  const hops = process.env.TRUST_PROXY
  if (hops) app.set('trust proxy', /^\d+$/.test(hops) ? Number(hops) : hops)

  app.use(helmet())
  app.use(cors({ origin: corsOrigins() }))
  // Razorpay signs the exact bytes it sends, so this route reads the raw body before the JSON parser.
  app.post('/api/payment/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const cfg = rzp.razorpayConfig()
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    const signature = req.header('x-razorpay-signature') ?? ''
    if (!cfg || !signature || !rzp.verifyWebhookSignature(raw, signature, cfg.webhookSecret)) return res.status(400).json({ error: 'Bad signature' })
    let event: any
    try { event = JSON.parse(raw.toString('utf8')) } catch { return res.status(400).json({ error: 'Bad body' }) }

    await db.tx(async (q) => {
      if (event.event === 'payment.captured') {
        const p = event.payload?.payment?.entity
        const found = p && (await q.query(`SELECT payment_id, intent FROM payments WHERE intent->>'rzpOrderId' = $1`, [String(p.order_id)]))
        if (found?.length && Math.round(found[0].intent.amount * 100) === p.amount) await settlePaid(q, found[0].payment_id, String(p.id))
      } else if (event.event === 'refund.processed') {
        const r = event.payload?.refund?.entity
        const found = r && (await q.query('SELECT order_id FROM refunds WHERE gateway_refund_id = $1', [String(r.id)]))
        if (found?.length) await refunds.markProcessed(q, found[0].order_id)
      }
    })
    return res.json({ received: true })
  })

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

  app.post('/api/auth/otp/send', otpSendLimit, async (req, res) => {
    const ph = phone(bodyOf(req).phone)
    // No SMS provider is wired up yet. Until one is, codes are only issued in demo mode,
    // and are returned in the response. Production must not hand codes to the caller.
    if (!demoOtpEnabled()) return res.status(503).json({ error: 'SMS delivery is not configured' })

    const otp = randomDigits(6)
    await otpStore.set(ph, { otp, expiresAt: Date.now() + 5 * 60 * 1000 }, 300)
    return res.json({ success: true, message: `OTP sent to ${ph}.`, expiresInSeconds: 300, devOtp: otp })
  })

  app.post('/api/auth/otp/verify', otpVerifyLimit, async (req, res) => {
    const b = bodyOf(req)
    const ph = phone(b.phone)
    const otp = str(b.otp, 'otp', { min: 6, max: 6 })
    const role = oneOf<Role>(b.requestedRole ?? 'customer', 'requestedRole', ['customer', 'scribe', 'admin'])
    if (!/^\d{6}$/.test(otp)) throw new ValidationError('otp must be 6 digits')
    if (role === 'admin' && !adminPhones().has(ph)) throw forbid('This number cannot sign in as admin')

    if (otpAttempts.lockedForMs(ph) > 0) {
      return res.status(429).json({ error: 'Too many wrong codes. Try again in 15 minutes.' })
    }
    const session = await otpStore.get(ph)
    if (!session || Date.now() > session.expiresAt || !safeEqual(session.otp, otp)) {
      otpAttempts.fail(ph)
      if (otpAttempts.lockedForMs(ph) > 0) await otpStore.del(ph)
      return res.status(401).json({ error: 'Invalid or expired OTP' })
    }

    await otpStore.del(ph)
    otpAttempts.clear(ph)

    const acceptedVersion = optStr(b.acceptedPolicyVersion, 'acceptedPolicyVersion', 40)
    const storageConsent = typeof b.storageConsent === 'boolean' ? b.storageConsent : false
    if (acceptedVersion) {
      await legal.recordAcceptance(db, ph, role, acceptedVersion, storageConsent)
    }

    return res.json({
      success: true,
      token: signSession({ phone: ph, role }),
      acceptedPolicyVersion: acceptedVersion ?? null,
      policyVersion: POLICY_VERSION,
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
    const stars = await db.query<{ scribe_id: string; avg: string; n: string }>(
      `SELECT scribe_id, avg(stars) AS avg, count(*) AS n FROM ratings GROUP BY scribe_id`,
    )
    const scribes = all
      .filter((x) => x.isApproved && !x.isSuspended)
      .filter((x) => pilot.showDemoScribes() || !pilot.isDemoScribe(x.scribeId))
      .map((x) => {
        const r = stars.find((d) => d.scribe_id === x.scribeId)
        return {
        id: x.scribeId,
        name: x.name,
        college: x.college,
        specialties: x.specialties ?? [],
        sample: x.sampleCardText,
        sampleImageUrl: x.handwritingSampleUrl || undefined,
        completedOrders: Number(done.find((d) => d.scribe_id === x.scribeId)?.n ?? 0),
        available: !busy.has(x.scribeId),
        rating: r ? Math.round(Number(r.avg) * 10) / 10 : null,
        ratingCount: Number(r?.n ?? 0),
        isSample: pilot.isDemoScribe(x.scribeId),
        }
      })
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

  app.get('/api/payment/config', requireAuth('customer', 'admin'), (_req, res) => {
    const cfg = rzp.razorpayConfig()
    res.json({ provider: rzp.paymentProvider(), keyId: rzp.paymentProvider() === 'razorpay' ? cfg?.keyId : undefined })
  })

  /** Marks a payment successful and the order Paid. Safe to call twice (client and webhook both do). */
  async function settlePaid(q: Queryable, paymentId: string, rzpPaymentId?: string) {
    const rows = await q.query<{ intent: UpiPaymentIntent }>('SELECT intent FROM payments WHERE payment_id = $1 FOR UPDATE', [paymentId])
    const intent = rows[0]?.intent
    if (!intent || intent.status === 'SUCCESS') return
    const order = await fetchOrder(q, intent.orderId, true)
    if (!order) return
    intent.status = 'SUCCESS'
    if (rzpPaymentId) intent.rzpPaymentId = rzpPaymentId
    await q.query('UPDATE payments SET intent = $2::jsonb WHERE payment_id = $1', [paymentId, JSON.stringify(intent)])
    if (order.status === 'Draft') await applyTransition(q, order, 'Paid', 'Payment received.')
    // The customer cancelled while the payment was still in flight: give the money straight back.
    else if (order.status === 'Cancelled') await refunds.recordRefund(q, order, 'CUSTOMER_CANCELLED', refundsAreInstant())
  }

  app.post('/api/payment/razorpay/order', sensitiveLimit, requireAuth('customer', 'admin'), async (req, res) => {
    const cfg = rzp.razorpayConfig()
    if (rzp.paymentProvider() !== 'razorpay' || !cfg) return res.status(503).json({ error: 'Online payments are not set up yet' })
    const order = await fetchOrder(db, idLike(bodyOf(req).orderId, 'orderId'))
    if (!order || !canView(order, sessionOf(res))) throw notFound('Order not found')
    if (order.status !== 'Draft') throw new HttpError(409, 'This order has already been paid')

    // The server prices the order. The browser never says how much to charge.
    const made = await rzp.createRazorpayOrder(cfg, order.customerTotal, order.id)
    const paymentId = `PAY-${Date.now()}-${randomToken(3)}`
    const intent: UpiPaymentIntent = {
      paymentId, orderId: order.id, amount: order.customerTotal, payerVpa: '', payeeVpa: '', qrDataUrl: '', deepLink: '',
      status: 'INITIATED', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      provider: 'razorpay', rzpOrderId: made.id,
    }
    await db.query('INSERT INTO payments (payment_id, order_id, intent) VALUES ($1,$2,$3::jsonb)', [paymentId, order.id, JSON.stringify(intent)])
    return res.json({ success: true, paymentId, keyId: cfg.keyId, rzpOrderId: made.id, amount: order.customerTotal })
  })

  app.post('/api/payment/razorpay/verify', sensitiveLimit, requireAuth('customer', 'admin'), async (req, res) => {
    const cfg = rzp.razorpayConfig()
    if (rzp.paymentProvider() !== 'razorpay' || !cfg) return res.status(503).json({ error: 'Online payments are not set up yet' })
    const b = bodyOf(req)
    const paymentId = str(b.paymentId, 'paymentId', { max: 60 })
    const rzpPaymentId = str(b.razorpayPaymentId, 'razorpayPaymentId', { max: 60 })
    const signature = str(b.razorpaySignature, 'razorpaySignature', { max: 200 })
    const out = await db.tx(async (q) => {
      const { intent } = await loadPayment(q, paymentId, sessionOf(res), true)
      if (intent.provider !== 'razorpay' || !intent.rzpOrderId) throw new HttpError(400, 'Not an online payment')
      if (!rzp.verifyCheckoutSignature(intent.rzpOrderId, rzpPaymentId, signature, cfg.keySecret)) throw new HttpError(400, 'Payment could not be verified')
      await settlePaid(q, paymentId, rzpPaymentId)
      return { success: true }
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
    const list = rows.map(orderFromRow)
    const rf = s.role === 'scribe' ? new Map() : await refunds.refundsFor(db, list.map((o) => o.id))
    res.json({ success: true, orders: list.map((o) => ({ ...publicOrder(o, s), ...(rf.has(o.id) ? { refund: rf.get(o.id) } : {}) })) })
  })

  app.get('/api/orders/:id', requireAuth(), async (req, res) => {
    const s = sessionOf(res)
    const order = await loadVisible(db, idLike(req.params.id, 'order id'), s)
    const refund = s.role === 'scribe' ? undefined : (await refunds.refundsFor(db, [order.id])).get(order.id)
    res.json({ success: true, order: { ...publicOrder(order, s), ...(refund ? { refund } : {}) } })
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
    if (checkConfidentialBlocklist(title).blocked) {
      throw new ValidationError('Confidential or exam material is not permitted on ScribeLink')
    }
    const subject = optStr(b.subject, 'subject', 60) ?? 'General'
    const penStyle = optStr(b.penStyle, 'penStyle', 40) ?? 'Ballpoint · Blue'
    const gateId = optStr(b.gateId, 'gateId', 40)
    if (!gateId && b.dropGate === undefined) throw new ValidationError('Choose where to deliver the pages (a saved gate or a new one)')
    const notesFileId = optStr(b.notesFileId, 'notesFileId', 40)
    if (notesFileId) idLike(notesFileId, 'notesFileId')
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
      notesFileId,
      createdAt: new Date().toISOString(),
      finalDeadline: computeDeadlines(q.pages).formattedFinalDeadline,
      timeline: [{ status: 'Draft', timestamp: new Date().toISOString(), note: 'Order created. Waiting for payment.' }],
      discount: 0,
    }
    await db.tx(async (q) => {
      // Credits come out of ScribeLink's share; the customer always pays at least the scribe's payout.
      order.discount = await referrals.reserveCredit(q, s.phone, order.id, order.customerTotal, order.scribePayout)
      order.customerTotal = Math.round((order.customerTotal - order.discount) * 100) / 100
      if (gateId) {
        const saved = await addr.getAddress(q, gateId, s.phone)
        if (!saved) throw new ValidationError('That gate is not in your saved places')
        const { id: _i, kind: _k, ...copy } = saved
        order.dropGate = copy
      } else order.dropGate = addr.parseAddress(b.dropGate, 'dropGate')
      await insertOrder(q, order)
      if (notesFileId && !(await files.attachFile(q, notesFileId, order.id, s.phone))) throw new ValidationError('That notes file is not yours or no longer exists')
    })
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
        if (next === 'Cancelled' && !customerCanCancel(order.status)) {
          throw forbid('You can no longer cancel because writing has started. If something is wrong with the delivered notes, open a dispute.')
        }
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
      await applyTransition(q, order, next, note ?? check.auditLog, s.role === 'customer' ? 'CUSTOMER_CANCELLED' : 'ADMIN_CANCELLED')
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
    const xCfg = razorpayXConfig()

    const { withdrawn, tdsAmount } = await db.tx(async (q) => {
      // Lock the scribe's row so two withdrawals at once cannot both take the same balance.
      await q.query('SELECT 1 FROM scribes WHERE scribe_id = $1 FOR UPDATE', [id])
      const rec = await logi.getScribe(q, id)
      if (!rec || !rec.upiVpa) throw new HttpError(400, 'Add your UPI ID in your profile first')
      if (rec.isSuspended) throw forbid('Your account is suspended')
      const { walletBalance } = await walletOf(q, id)
      if (walletBalance <= 0) throw new HttpError(400, 'Nothing to withdraw yet')

      const prevYtd = await ytdGross(q, id)
      const { grossAmount, tdsAmount, netAmount } = calcTds(walletBalance, prevYtd)
      const txId = `TX-${randomDigits(6)}`
      const result = await issuePayout(xCfg, id, rec.name, s.phone, rec.upiVpa, netAmount, txId)

      await q.query(
        `INSERT INTO withdrawals (id, scribe_id, amount, upi_vpa, provider, provider_ref, status, tds_amount, failure_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [txId, id, grossAmount, rec.upiVpa, result.provider, result.providerRef ?? null, result.status, tdsAmount, result.failureReason ?? null],
      )
      await recordTds(q, id, grossAmount, tdsAmount)

      return { withdrawn: grossAmount, tdsAmount }
    })

    return res.json({ success: true, withdrawn, tdsDeducted: tdsAmount, ...(await scribeView(db, s.phone)) })
  })

  // Phase 16: capacity controls — daily page limit and vacation switch
  app.put('/api/scribe/capacity', requireAuth('scribe'), async (req, res) => {
    const s = sessionOf(res)
    const id = scribeIdFor(s.phone)
    const b = bodyOf(req)
    const maxPages = int(b.maxPagesToday ?? 100, 'maxPagesToday', 0, 500)
    const onVacation = typeof b.onVacation === 'boolean' ? b.onVacation : false
    await db.query(
      'UPDATE scribes SET max_pages_today=$1, on_vacation=$2 WHERE scribe_id=$3',
      [maxPages, onVacation, id],
    )
    return res.json({ success: true, maxPagesToday: maxPages, onVacation })
  })

  // Phase 16: save encrypted PAN + verification document URLs
  app.put('/api/scribe/verification', sensitiveLimit, requireAuth('scribe'), async (req, res) => {
    const s = sessionOf(res)
    const id = scribeIdFor(s.phone)
    const b = bodyOf(req)
    const panPlain = str(b.pan, 'pan', { max: 10 }).trim().toUpperCase()
    if (!validatePan(panPlain)) throw new ValidationError('pan must be a valid Indian PAN (e.g. ABCDE1234F)')
    const rawCollegeId = str(b.collegeIdUrl, 'collegeIdUrl', { max: 500 })
    const rawSelfie = str(b.selfieUrl, 'selfieUrl', { max: 500 })
    const collegeIdUrl = rawCollegeId.startsWith('/api/') ? rawCollegeId : mediaUrl(rawCollegeId, 'collegeIdUrl')
    const selfieUrl = rawSelfie.startsWith('/api/') ? rawSelfie : mediaUrl(rawSelfie, 'selfieUrl')

    let panEncrypted: string
    try {
      panEncrypted = encryptPan(panPlain)
    } catch {
      throw new HttpError(500, 'PAN encryption is not configured on this server')
    }

    await db.query(
      `UPDATE scribes SET pan_encrypted=$1, pan_last4=$2, college_id_url=$3, selfie_url=$4, id_verified=false
       WHERE scribe_id=$5`,
      [panEncrypted, panLast4(panPlain), collegeIdUrl, selfieUrl, id],
    )
    return res.json({ success: true, panLast4: panLast4(panPlain), idVerified: false })
  })

  // Phase 16: monthly earnings statement
  app.get('/api/scribe/statement', requireAuth('scribe'), async (_req, res) => {
    const s = sessionOf(res)
    const id = scribeIdFor(s.phone)
    const statement = await monthlyStatement(db, id)
    return res.json({ success: true, statement })
  })

  // Phase 16: admin — verify scribe ID documents (college ID + selfie + PAN)
  app.post('/api/admin/scribes/:id/verify-id', requireAuth('admin'), async (req, res) => {
    const id = idLike(req.params.id, 'scribe id')
    const approved = bool(bodyOf(req).idVerified, 'idVerified')
    const scribe = await logi.getScribe(db, id)
    if (!scribe) throw notFound('Scribe not found')
    await db.query('UPDATE scribes SET id_verified=$1 WHERE scribe_id=$2', [approved, id])
    return res.json({ success: true, scribeId: id, idVerified: approved })
  })

  // ── 5b. Saved places ───────────────────────────────────────────────────────

  const kindFor = (s: Session): addr.AddressKind => (s.role === 'scribe' ? 'pickup' : 'gate')

  app.get('/api/addresses', requireAuth('customer', 'scribe'), async (_req, res) => {
    const s = sessionOf(res)
    res.json({ success: true, addresses: await addr.listAddresses(db, s.phone, kindFor(s)) })
  })

  app.post('/api/addresses', requireAuth('customer', 'scribe'), async (req, res) => {
    const s = sessionOf(res)
    const a = addr.parseAddress(bodyOf(req))
    const saved = await db.tx((q) => addr.saveAddress(q, `ADDR-${randomToken(6).toUpperCase()}`, s.phone, kindFor(s), a))
    res.status(201).json({ success: true, address: saved })
  })

  app.delete('/api/addresses/:id', requireAuth('customer', 'scribe'), async (req, res) => {
    const ok = await addr.deleteAddress(db, idLike(req.params.id, 'address id'), sessionOf(res).phone)
    if (!ok) throw notFound('Address not found')
    res.json({ success: true })
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
    async (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      const verdict = validateUpload({ name: uploadName(req), size: bytes.length }, bytes, 'video')
      if (!verdict.ok) return res.status(400).json({ error: verdict.error })
      const id = await storeUpload(db, bytes, 'mp4', 'evidence', sessionOf(res).phone)
      return res.status(201).json({ success: true, url: `/api/media/${id}` })
    },
  )

  // The customer's notes. They are read back only by the owner, the assigned scribe and admins.
  app.post(
    '/api/uploads/notes',
    sensitiveLimit,
    requireAuth('customer'),
    express.raw({ type: 'application/octet-stream', limit: '20mb' }),
    async (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      const verdict = validateUpload({ name: uploadName(req), size: bytes.length }, bytes, 'document')
      if (!verdict.ok) return res.status(400).json({ error: verdict.error })
      const id = await storeUpload(db, bytes, verdict.type, 'notes', sessionOf(res).phone)
      return res.status(201).json({ success: true, fileId: id })
    },
  )

  app.get('/api/orders/:id/invoice', requireAuth('customer', 'admin'), async (req, res) => {
    const s = sessionOf(res)
    const order = await loadVisible(db, idLike(req.params.id, 'order id'), s)
    if (!order.timeline.some((t) => t.status === 'Paid')) throw new HttpError(409, 'An invoice is available once the order is paid')
    const refund = (await refunds.refundsFor(db, [order.id])).get(order.id)
    const pdf = await renderInvoice(order, sellerFromEnv(), refund)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${order.id}.pdf"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(pdf)
  })

  app.get('/api/orders/:id/notes', requireAuth(), async (req, res) => {
    const s = sessionOf(res)
    const order = await loadVisible(db, idLike(req.params.id, 'order id'), s)
    const isOwner = ownsOrder(order, s)
    const isWorking = s.role === 'scribe' && order.scribeId === scribeIdFor(s.phone) && ['Accepted', 'Writing', 'Dispatched', 'Delivered', 'Disputed'].includes(order.status)
    if (!(s.role === 'admin' || isOwner || isWorking)) throw forbid()
    const info = order.notesFileId ? await files.fileInfo(db, order.notesFileId) : undefined
    const found = info ? findUpload(info.id, [info.type]) : undefined
    if (!info || !found) return res.status(404).json({ error: 'No notes file for this order' })
    const mime: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', text: 'text/plain; charset=utf-8' }
    res.setHeader('Content-Type', mime[info.type] ?? 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="notes-${order.id}.${info.type === 'text' ? 'txt' : info.type}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    return fs.createReadStream(found.file).pipe(res)
  })

  // Handwriting sample photos are shown to customers, so they are served without sign-in.
  app.post(
    '/api/uploads/sample',
    sensitiveLimit,
    requireAuth('scribe'),
    express.raw({ type: 'application/octet-stream', limit: '9mb' }),
    async (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      const verdict = validateUpload({ name: uploadName(req), size: bytes.length }, bytes, 'image')
      if (!verdict.ok) return res.status(400).json({ error: verdict.error })
      const id = await storeUpload(db, bytes, verdict.type, 'sample', sessionOf(res).phone)
      return res.status(201).json({ success: true, url: `/api/samples/${id}` })
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

    const { escrowReleased, rushResults, filesDeleted, unclaimedRefunded } = await runScheduledJobs(db, now)
    const cfg = rzp.razorpayConfig()
    const refundsSent = cfg && rzp.paymentProvider() === 'razorpay'
      ? await refunds.sendPendingRefunds(db, (paymentId, amount, orderId) => rzp.refundRazorpayPayment(cfg, paymentId, amount, orderId))
      : undefined
    return res.json({
      success: true,
      simulatedTime: now.toISOString(),
      escrowReleased,
      rushResults,
      filesDeleted,
      unclaimedRefunded,
      refundsSent,
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

      if (courier.courierProvider() === 'manual') {
        if (b.packed !== true) throw new ValidationError('Confirm the pages are packed before asking for a pickup')
        if (order.status !== 'Writing') throw new HttpError(409, 'Only an order being written can be sent for pickup')
        const existing = await courier.getTask(q, orderId)
        if (existing && ['BOOKING_REQUESTED', 'RIDER_ASSIGNED', 'PICKED_UP'].includes(existing.status)) return { task: courier.scribeView(existing), order: publicOrder(order, s) }
        const owner = s.role === 'scribe' ? s.phone : order.scribeId ? (await logi.getScribe(q, order.scribeId))?.phone : undefined
        const from = owner ? (await addr.listAddresses(q, owner, 'pickup'))[0] : undefined
        if (!from) throw new ValidationError('The scribe needs a pickup address in their profile first')
        const task = await courier.requestPickup(q, {
          orderId,
          pickupAddress: addr.addressLine(from),
          dropGate: order.dropGate ? addr.addressLine(order.dropGate) : 'Gate not set',
          deliveryOtp: order.deliveryOtp,
          pickupContact: { name: from.contactName, phone: from.contactPhone },
          dropContact: order.dropGate ? { name: order.dropGate.contactName, phone: order.dropGate.contactPhone } : undefined,
        })
        // The pages are written, so the hourly check-in clock stops. The scribe is now waiting for a rider.
        await sched.closeRushWatch(q, order.id)
        await sched.audit(q, `[COURIER] Pickup requested for ${orderId}. Waiting for a rider to be booked.`)
        return { task: courier.scribeView(task), order: publicOrder(order, s) }
      }

      const scribePhone = s.role === 'scribe' ? s.phone : order.scribeId ? (await logi.getScribe(q, order.scribeId))?.phone : undefined
      const saved = scribePhone ? (await addr.listAddresses(q, scribePhone, 'pickup'))[0] : undefined
      const task = await logi.createCourierDispatch(
        q,
        orderId,
        dropGate ?? (order.dropGate ? addr.addressLine(order.dropGate) : undefined),
        pickup ?? (saved ? addr.addressLine(saved) : undefined),
        partner,
        order.deliveryOtp,
        order.customerPhone,
      )
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
      if (courier.courierProvider() === 'manual' && s.role !== 'admin') throw forbid('The rider confirms delivery with the code. Give the code to the rider at the gate.')
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

  const riderLink = (token: string) => {
    const base = process.env.PUBLIC_APP_URL ?? (process.env.CORS_ORIGINS ?? '').split(',')[0]?.trim() ?? ''
    return `${(base || 'http://localhost:5173').replace(/\/$/, '')}/rider/${token}`
  }

  /** What each kind of signed-in user may know about the courier for an order. */
  app.get('/api/orders/:id/courier', requireAuth(), async (req, res) => {
    const s = sessionOf(res)
    const order = await loadVisible(db, idLike(req.params.id, 'order id'), s)
    const t = await courier.getTask(db, order.id)
    if (!t) return res.json({ success: true, courier: null })
    return res.json({ success: true, courier: s.role === 'scribe' ? courier.scribeView(t) : courier.customerView(t) })
  })

  app.get('/api/admin/courier', requireAuth('admin'), async (_req, res) => {
    const rows = await db.query<{ task: CourierTask }>(`SELECT task FROM courier_tasks WHERE task->>'status' IN ('BOOKING_REQUESTED','RIDER_ASSIGNED','PICKED_UP') ORDER BY task->>'createdAt'`)
    res.json({
      success: true,
      tasks: rows.map(({ task: t }) => ({
        orderId: t.orderId, status: t.status, pickupAddress: t.pickupAddress, dropGate: t.dropGate, pickupContact: t.pickupContact, dropContact: t.dropContact,
        riderName: t.courierRiderName, riderPhone: t.courierRiderPhone, trackingUrl: t.trackingUrl, attempts: t.attempts ?? 1,
        needsAttention: (t.attempts ?? 1) > courier.MAX_ATTEMPTS, history: t.history ?? [],
        riderLink: t.riderToken ? riderLink(t.riderToken) : undefined,
      })),
    })
  })

  app.post('/api/admin/courier/:orderId/assign', requireAuth('admin'), async (req, res) => {
    const b = bodyOf(req)
    const orderId = idLike(req.params.orderId, 'orderId')
    const out = await db.tx(async (q) => {
      const order = await fetchOrder(q, orderId, true)
      if (!order) throw notFound('Order not found')
      const rider = {
        name: str(b.riderName, 'riderName', { max: 60 }),
        phone: phone(b.riderPhone, 'riderPhone'),
        trackingUrl: optStr(b.trackingUrl, 'trackingUrl', 300),
        trackingId: optStr(b.trackingId, 'trackingId', 60),
      }
      let t: CourierTask
      try { t = await courier.assignRider(q, orderId, rider) } catch (e) { throw new HttpError(409, (e as Error).message) }
      if (order.customerPhone) await logi.sendNotification(q, order.customerPhone, 'WHATSAPP', 'RIDER_ASSIGNED', `ScribeLink: ${t.courierRiderName} will collect your notes from the scribe.${t.trackingUrl ? ` Track: ${t.trackingUrl}` : ''}`)
      await sched.audit(q, `[COURIER] Rider ${t.courierRiderName} assigned to ${orderId}.`)
      return { riderLink: riderLink(t.riderToken!), whatsapp: `https://wa.me/${t.courierRiderPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`ScribeLink parcel ${orderId}. Open this link at pickup and delivery: ${riderLink(t.riderToken!)}`)}` }
    })
    res.json({ success: true, ...out })
  })

  app.post('/api/admin/courier/:orderId/rebook', requireAuth('admin'), async (req, res) => {
    const orderId = idLike(req.params.orderId, 'orderId')
    const reason = str(bodyOf(req).reason, 'reason', { max: 200 })
    const out = await db.tx(async (q) => {
      let r
      try { r = await courier.rebook(q, orderId, reason) } catch (e) { throw new HttpError(409, (e as Error).message) }
      await sched.audit(q, `[COURIER] Rebooking ${orderId} (attempt ${r.task.attempts}): ${reason}${r.needsAttention ? '. NEEDS ATTENTION: three riders have failed.' : ''}`)
      return { attempts: r.task.attempts, needsAttention: r.needsAttention }
    })
    res.json({ success: true, ...out })
  })

  // The rider has no account. Their private link is the key, so these routes are rate limited.
  app.get('/api/rider/:token', sensitiveLimit, async (req, res) => {
    const t = await courier.getTaskByToken(db, str(req.params.token, 'token', { max: 60 }))
    if (!t) throw notFound('This link is not valid any more')
    res.json({ success: true, task: courier.riderView(t) })
  })

  app.post('/api/rider/:token/pickup', sensitiveLimit, async (req, res) => {
    const code = str(bodyOf(req).pickupOtp, 'pickupOtp', { min: 4, max: 8 })
    const out = await db.tx(async (q) => {
      const t = await courier.getTaskByToken(q, str(req.params.token, 'token', { max: 60 }))
      if (!t) throw notFound('This link is not valid any more')
      if (pickupAttempts.lockedForMs(t.orderId) > 0) return { error: 'Too many wrong codes. Try again in 15 minutes.', status: 429 }
      const r = await courier.confirmPickup(q, t, code)
      if (!r.ok) { pickupAttempts.fail(t.orderId); return { error: r.error!, status: 400 } }
      pickupAttempts.clear(t.orderId)
      const order = await fetchOrder(q, t.orderId, true)
      if (order?.status === 'Writing') await applyTransition(q, order, 'Dispatched', `Picked up by ${t.courierRiderName}.`)
      if (order?.customerPhone) await logi.sendNotification(q, order.customerPhone, 'WHATSAPP', 'COURIER_DISPATCHED', `ScribeLink: ${t.courierRiderName} has your notes and is heading to ${t.dropGate}. When they arrive, read out your delivery code ${order.deliveryOtp}.`)
      return { ok: true as const, task: courier.riderView(t) }
    })
    if ('error' in out) return res.status((out as { status: number }).status).json({ error: out.error })
    return res.json({ success: true, task: out.task })
  })

  app.post('/api/rider/:token/deliver', sensitiveLimit, async (req, res) => {
    const code = str(bodyOf(req).deliveryOtp, 'deliveryOtp', { min: 4, max: 8 })
    const out = await db.tx(async (q) => {
      const t = await courier.getTaskByToken(q, str(req.params.token, 'token', { max: 60 }))
      if (!t) throw notFound('This link is not valid any more')
      if (t.status !== 'PICKED_UP') return { error: 'Collect the parcel from the scribe first', status: 409 }
      if (deliveryAttempts.lockedForMs(t.orderId) > 0) return { error: 'Too many wrong codes. Try again in 15 minutes.', status: 429 }
      const order = await fetchOrder(q, t.orderId, true)
      if (!order) throw notFound('Order not found')
      const r = await logi.confirmGateDelivery(q, t.orderId, code, undefined, order.customerPhone)
      if (!r.success) { deliveryAttempts.fail(t.orderId); return { error: 'That code is not right. Ask the person at the gate to read it from their phone.', status: 400 } }
      deliveryAttempts.clear(t.orderId)
      if (order.status === 'Dispatched' && order.scribeId) await applyTransition(q, order, 'Delivered', 'Delivery code confirmed at the gate.')
      return { ok: true as const }
    })
    if ('error' in out) return res.status((out as { status: number }).status).json({ error: out.error })
    return res.json({ success: true })
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
      if (MEDIA_PATH.test(video)) await files.attachFile(q, video.slice('/api/media/'.length), orderId, s.role === 'admin' ? null : s.phone)
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
      if (order && decision !== 'RELEASED_TO_SCRIBE') {
        await refunds.recordRefund(q, order, decision === 'SPLIT' ? 'DISPUTE_SPLIT' : 'DISPUTE_UPHELD', refundsAreInstant())
      }
      if (order && validateTransition(order.status, 'Closed').success) {
        await applyTransition(q, order, 'Closed', `Dispute ${id} ruled ${decision}.`)
      }
      return r
    })
    return res.json({ success: true, dispute: resolved })
  })

  app.get('/api/admin/refunds', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, refunds: await refunds.allRefunds(db) })
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

  app.get('/api/notifications', requireAuth('customer', 'scribe'), async (_req, res) => {
    res.json({ success: true, ...(await notify.inbox(db, sessionOf(res).phone)) })
  })

  app.post('/api/notifications/read', requireAuth('customer', 'scribe'), async (_req, res) => {
    await notify.markAllRead(db, sessionOf(res).phone)
    res.json({ success: true })
  })

  // ── Ratings and support ───────────────────────────────────────────────────

  app.get('/api/orders/:id/rating', requireAuth('customer'), async (req, res) => {
    const order = await loadVisible(db, idLike(req.params.id, 'order id'), sessionOf(res))
    res.json({ success: true, rating: await feedback.ratingOf(db, order.id) })
  })

  app.post('/api/orders/:id/rating', requireAuth('customer'), async (req, res) => {
    const b = bodyOf(req)
    const stars = int(b.stars, 'stars', 1, 5)
    const comment = optStr(b.comment, 'comment', 500) ?? ''
    const order = await loadVisible(db, idLike(req.params.id, 'order id'), sessionOf(res))
    if (order.customerPhone !== sessionOf(res).phone) throw notFound('Order not found')
    if (!['Delivered', 'Closed'].includes(order.status) || !order.scribeId) throw new HttpError(409, 'You can rate a scribe after the pages are delivered')
    if (!(await feedback.addRating(db, order.id, order.scribeId, stars, comment))) throw new HttpError(409, 'You have already rated this order')
    res.json({ success: true })
  })

  app.post('/api/tickets', requireAuth('customer', 'scribe'), async (req, res) => {
    const b = bodyOf(req)
    const s = sessionOf(res)
    let orderId: string | null = null
    if (b.orderId) orderId = (await loadVisible(db, idLike(b.orderId, 'order id'), s)).id
    const t = await feedback.openTicket(db, s.phone, orderId, str(b.subject, 'subject', { min: 3, max: 120 }), str(b.body, 'body', { min: 5, max: 2000 }))
    res.json({ success: true, ticket: t })
  })

  app.get('/api/tickets', requireAuth('customer', 'scribe'), async (_req, res) => {
    res.json({ success: true, tickets: await feedback.ticketsFor(db, sessionOf(res).phone) })
  })

  app.get('/api/admin/tickets', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, tickets: await feedback.allTickets(db), lowRated: await feedback.lowRatedScribes(db) })
  })

  app.post('/api/admin/tickets/:id/close', requireAuth('admin'), async (req, res) => {
    const t = await feedback.closeTicket(db, idLike(req.params.id, 'ticket id'), str(bodyOf(req).reply, 'reply', { min: 1, max: 1000 }))
    if (!t) throw notFound('Ticket not found')
    await notify.notifyOnce(db, `${t.id}:closed`, t.phone, 'TICKET_CLOSED', `ScribeLink: your ticket ${t.id} was answered: ${t.reply}`)
    res.json({ success: true, ticket: t })
  })

  app.get('/api/admin/notifications', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, notifications: await logi.getNotificationLogs(db) })
  })

  // ── Phase 17: Admin dashboard, search, manual ops, CSV export ──────────────

  app.get('/api/admin/stats', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, stats: await adminOps.getAdminDashboardStats(db) })
  })

  app.get('/api/admin/orders', requireAuth('admin'), async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : ''
    res.json({ success: true, orders: await adminOps.searchAdminOrders(db, q) })
  })

  app.get('/api/admin/audit-log', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, entries: await adminOps.getAuditLog(db, 100) })
  })

  app.post('/api/admin/orders/:id/reassign', requireAuth('admin'), async (req, res) => {
    const orderId = idLike(req.params.id, 'orderId')
    const reason = optStr(bodyOf(req).reason, 'reason', 200) ?? 'Manual admin reassignment'
    const updated = await db.tx(async (q) => {
      const order = await fetchOrder(q, orderId, true)
      if (!order) throw notFound('Order not found')
      if (!validateTransition(order.status, 'Reassigned').success) {
        throw new HttpError(409, `Cannot reassign an order in status ${order.status}`)
      }
      const prevScribe = order.scribeId
      order.scribeId = undefined
      order.scribeName = undefined
      order.intakeDeadline = undefined
      order.nextCheckInDue = undefined
      await q.query('UPDATE rush_watches SET is_closed=true WHERE order_id=$1', [orderId])
      await applyTransition(q, order, 'Reassigned', `Admin reassigned (${reason}). Previous scribe: ${prevScribe ?? 'none'}.`)
      await sched.audit(q, `[ADMIN] Reassigned ${orderId} from ${prevScribe ?? 'unassigned'}: ${reason}`)
      return order
    })
    return res.json({ success: true, order: updated })
  })

  app.post('/api/admin/orders/:id/refund', requireAuth('admin'), async (req, res) => {
    const orderId = idLike(req.params.id, 'orderId')
    const reason = optStr(bodyOf(req).reason, 'reason', 200) ?? 'Admin manual refund'
    const out = await db.tx(async (q) => {
      const order = await fetchOrder(q, orderId, true)
      if (!order) throw notFound('Order not found')
      const r = await refunds.recordRefund(q, order, 'ADMIN_CANCELLED', refundsAreInstant())
      if (validateTransition(order.status, 'Cancelled').success) {
        await applyTransition(q, order, 'Cancelled', `Admin refund: ${reason}`)
      }
      await sched.audit(q, `[ADMIN] Manual refund on ${orderId}: ${reason}`)
      return r
    })
    return res.json({ success: true, refund: out })
  })

  app.post('/api/admin/scribes/:id/suspend', requireAuth('admin'), async (req, res) => {
    const id = idLike(req.params.id, 'scribe id')
    const suspended = bool(bodyOf(req).suspended, 'suspended')
    const scribe = await db.tx(async (q) => {
      if (!(await logi.getScribe(q, id))) throw notFound('Scribe not found')
      await q.query(
        `INSERT INTO scribe_strikes (scribe_id, strikes, is_suspended)
         VALUES ($1, 0, $2)
         ON CONFLICT (scribe_id) DO UPDATE SET is_suspended = EXCLUDED.is_suspended`,
        [id, suspended],
      )
      await sched.audit(q, `[ADMIN] Scribe ${id} ${suspended ? 'suspended' : 'reinstated'}.`)
      return logi.getScribe(q, id)
    })
    return res.json({ success: true, scribe })
  })

  app.post('/api/admin/notifications/resend', requireAuth('admin'), async (req, res) => {
    const b = bodyOf(req)
    const to = phone(b.phone, 'phone')
    const event = str(b.event, 'event', { max: 60 })
    const message = str(b.message, 'message', { max: 500 })
    await db.tx(async (q) => {
      await logi.sendNotification(q, to, 'WHATSAPP', event, message)
      await sched.audit(q, `[ADMIN] Resent ${event} message to ${to}.`)
    })
    return res.json({ success: true })
  })

  app.get('/api/admin/export/accounts.csv', requireAuth('admin'), async (_req, res) => {
    const csv = await adminOps.buildAccountsCsv(db)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="scribelink-accounts.csv"')
    return res.send(csv)
  })

  // ── Phase 18: Legal acceptance, DPDP data export/erasure, misuse reports ───

  app.get('/api/account/legal', requireAuth(), async (_req, res) => {
    const s = sessionOf(res)
    const acceptance = await legal.getLatestAcceptance(db, s.phone, s.role)
    res.json({ success: true, policyVersion: POLICY_VERSION, acceptance })
  })

  app.get('/api/account/data-export', requireAuth(), async (_req, res) => {
    const s = sessionOf(res)
    const data = await legal.exportUserData(db, s.phone)
    res.json({ success: true, data })
  })

  app.delete('/api/account/data', sensitiveLimit, requireAuth(), async (_req, res) => {
    const s = sessionOf(res)
    const result = await db.tx(async (q) => {
      const r = await legal.deleteUserData(q, s.phone)
      await sched.audit(q, `[DPDP] User ${s.phone} requested data deletion (${r.anonymizedOrders} orders anonymized, ${r.deletedAddresses} addresses deleted).`)
      return r
    })
    res.json({ success: true, ...result })
  })

  app.post('/api/reports', sensitiveLimit, requireAuth(), async (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const targetType = oneOf(b.targetType, 'targetType', ['order', 'scribe', 'customer', 'other'] as const)
    const targetId = str(b.targetId, 'targetId', { max: 60 })
    const reason = str(b.reason, 'reason', { min: 3, max: 120 })
    const details = optStr(b.details, 'details', 1000) ?? ''
    const report = await legal.createMisuseReport(db, s.phone, targetType, targetId, reason, details)
    res.status(201).json({ success: true, report })
  })

  app.get('/api/admin/reports', requireAuth('admin'), async (_req, res) => {
    res.json({ success: true, reports: await legal.listMisuseReports(db) })
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
      otpStore: otpStore.kind,
      fileStorage: s3ConfigFromEnv() ? 's3' : 'disk',
      phase: 19,
      production: isProduction(),
      timestamp: new Date().toISOString(),
    })
  })

  // ── Phase 20: referrals and pilot metrics ──────────────────────────────────

  app.get('/api/referrals/me', requireAuth('customer'), async (_req, res) => {
    res.json({ success: true, referral: await referrals.summary(db, sessionOf(res).phone), creditPerReferral: referrals.REFERRAL_CREDIT })
  })

  app.post('/api/referrals/apply', requireAuth('customer'), async (req, res) => {
    const code = str(bodyOf(req).code, 'code', { max: 20 })
    try {
      const out = await db.tx((q) => referrals.applyCode(q, sessionOf(res).phone, code))
      res.json({ success: true, ...out })
    } catch (e) {
      if (e instanceof referrals.ReferralError) throw new ValidationError(e.message)
      throw e
    }
  })

  app.get('/api/admin/pilot-metrics', requireAuth('admin'), async (req, res) => {
    const weeks = req.query.weeks === undefined ? 8 : int(Number(req.query.weeks), 'weeks', 1, 52)
    res.json({ success: true, weeks: await pilot.getPilotMetrics(db, weeks) })
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
    void reportError(err)
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
  // Sample scribes are for demos only: never seeded (or listed) in production.
  if (process.env.SEED_DEMO === 'true' && !isProduction()) await logi.seedDemoData(db)

  createApp(db).listen(PORT, () => {
    logEvent('info', 'server_started', { port: PORT, db: db.kind })
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
