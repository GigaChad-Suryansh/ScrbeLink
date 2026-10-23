/**
 * backend/server.ts
 * Express API for ScribeLink.
 *
 * Phase 7 hardening:
 * - Signed session tokens and role guards on every route that changes or reveals order data
 * - Admins come from an allowlist (ADMIN_PHONES); nobody can request the admin role
 * - Rate limits, brute-force lockouts (login OTP, delivery OTP), strict input validation
 * - Delivery OTP is only ever shown to the customer who owns the order
 * - Disputes freeze escrow; rush reassignment updates the order itself
 *
 * Data is still held in memory (see DEPLOYMENT.md): orders reset when the process restarts.
 */

import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { calculateQuote, checkCoverPage, countWords, sanitizeText } from '../shared/rules'
import {
  ALLOWED_TRANSITIONS,
  validateTransition,
  computeDeadlines,
  computeIntakeDeadline,
  computeNextCheckInDeadline,
  type OrderStateEnum,
} from '../shared/stateMachine'
import { createUpiPaymentIntent, verifyUpiPayment, getPayment } from './paymentGateway'
import { globalScheduler } from './scheduler'
import { globalLogistics } from './logisticsService'
import {
  AttemptLimiter,
  adminPhones,
  assertProductionConfig,
  isProduction,
  randomDigits,
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

// ── In-memory data ───────────────────────────────────────────────────────────

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
  intakeDeadline?: string
  nextCheckInDue?: string
  finalDeadline: string
  timeline: Array<{ status: string; timestamp: string; note: string }>
}

const dbOrders: OrderDoc[] = [
  {
    id: 'SL-7412',
    title: 'Macroeconomics Unit 3: Monetary Policy',
    subject: 'Economics',
    status: 'Writing',
    customerTotal: 248,
    scribePayout: 165,
    scribeId: 'S-2041',
    scribeName: 'S-2041',
    pages: 8,
    words: 1540,
    deliveryOtp: '741298',
    intakeDeadline: 'Passed',
    nextCheckInDue: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    finalDeadline: computeDeadlines(8).formattedFinalDeadline,
    timeline: [
      { status: 'Paid', timestamp: '2 hours ago', note: 'Escrow payment locked.' },
      { status: 'Accepted', timestamp: '1.8 hours ago', note: 'Scribe verified content within 30-min window.' },
      { status: 'Writing', timestamp: '1.5 hours ago', note: 'Writing in progress.' },
    ],
  },
]

const activeOtps = new Map<string, { otp: string; expiresAt: number }>()
const otpAttempts = new AttemptLimiter(5, FIFTEEN_MIN)
const deliveryAttempts = new AttemptLimiter(5, FIFTEEN_MIN)

const STATES = Object.keys(ALLOWED_TRANSITIONS) as OrderStateEnum[]
const SCRIBE_TARGETS = new Set<OrderStateEnum>(['Accepted', 'Writing', 'Dispatched'])
const CUSTOMER_TARGETS = new Set<OrderStateEnum>(['Cancelled', 'Closed'])

// ── Helpers ──────────────────────────────────────────────────────────────────

const bodyOf = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}

const demoOtpEnabled = () => !isProduction() || process.env.DEMO_OTP === 'true'
const testPaymentsAllowed = () => !isProduction() || process.env.ALLOW_TEST_PAYMENTS === 'true'

const ownsOrder = (o: OrderDoc, s: Session) => o.customerPhone !== undefined && o.customerPhone === s.phone

/** Customers see only their own orders. Scribes and admins see any (scribes only see IDs, never owners). */
const canView = (o: OrderDoc, s: Session) => s.role !== 'customer' || ownsOrder(o, s)

/** Strips the delivery OTP unless the viewer is the owning customer or an admin. */
function publicOrder(o: OrderDoc, s: Session): Omit<OrderDoc, 'customerPhone' | 'deliveryOtp'> & { deliveryOtp?: string } {
  const { customerPhone: _owner, deliveryOtp, ...rest } = o
  return s.role === 'admin' || ownsOrder(o, s) ? { ...rest, deliveryOtp } : rest
}

function loadOrder(req: Request, res: Response): OrderDoc | undefined {
  const id = idLike(req.params.id, 'order id')
  const order = dbOrders.find((o) => o.id === id)
  if (!order || !canView(order, sessionOf(res))) {
    res.status(404).json({ error: 'Order not found' })
    return undefined
  }
  return order
}

function newOrderId(): string {
  let id: string
  do id = `SL-${randomDigits(4)}`
  while (dbOrders.some((o) => o.id === id))
  return id
}

/** Moves an order to a new state and runs that state's side effects. The caller has already validated it. */
function applyTransition(order: OrderDoc, next: OrderStateEnum, note: string): void {
  order.status = next

  if (next === 'Accepted') {
    order.intakeDeadline = computeIntakeDeadline().toISOString()
  } else if (next === 'Writing' && order.scribeId) {
    const due = computeNextCheckInDeadline()
    order.nextCheckInDue = due.toISOString()
    globalScheduler.registerRushWatch(order.id, order.scribeId, order.scribeName ?? order.scribeId, due)
  } else if (next === 'Delivered' && order.scribeId) {
    globalScheduler.registerEscrowClock(order.id, order.scribeId, order.scribePayout)
  }

  order.timeline.push({ status: next, timestamp: new Date().toISOString(), note })
}

const forbid = (res: Response, msg = 'You are not allowed to do this') => res.status(403).json({ error: msg })

// ── App factory (tests build a fresh app so rate limits start clean) ─────────

export function createApp() {
  const app = express()

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
  const sensitiveLimit = limit(30)
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
    if (role === 'admin' && !adminPhones().has(ph)) return forbid(res, 'This number cannot sign in as admin')

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

  app.post('/api/payment/upi/initiate', sensitiveLimit, requireAuth('customer', 'admin'), (req, res) => {
    if (!testPaymentsAllowed()) return res.status(503).json({ error: 'UPI gateway is not configured' })
    const b = bodyOf(req)
    const orderId = idLike(b.orderId, 'orderId')
    const amount = rupees(b.amount)
    const payer = b.payerVpa === undefined ? 'student@upi' : upiId(b.payerVpa)

    const order = dbOrders.find((o) => o.id === orderId)
    if (!order || !canView(order, sessionOf(res))) return res.status(404).json({ error: 'Order not found' })
    // The server decides the price, so a client cannot pay less than the order total.
    if (Math.abs(amount - order.customerTotal) > 0.001) {
      return res.status(400).json({ error: 'Amount does not match the order total' })
    }
    return res.json({ success: true, payment: createUpiPaymentIntent(orderId, amount, payer) })
  })

  app.post('/api/payment/upi/verify', sensitiveLimit, requireAuth('customer', 'admin'), (req, res) => {
    if (!testPaymentsAllowed()) return res.status(503).json({ error: 'UPI gateway is not configured' })
    const b = bodyOf(req)
    const paymentId = str(b.paymentId, 'paymentId', { max: 60 })
    const forceSuccess = b.forceSuccess === undefined ? true : bool(b.forceSuccess, 'forceSuccess')

    const payment = getPayment(paymentId)
    const order = payment && dbOrders.find((o) => o.id === payment.orderId)
    if (!payment || !order || !canView(order, sessionOf(res))) return res.status(404).json({ error: 'Payment not found' })
    return res.json(verifyUpiPayment(paymentId, forceSuccess))
  })

  app.get('/api/payment/:id', requireAuth('customer', 'admin'), (req, res) => {
    const payment = getPayment(str(req.params.id, 'payment id', { max: 60 }))
    const order = payment && dbOrders.find((o) => o.id === payment.orderId)
    if (!payment || !order || !canView(order, sessionOf(res))) return res.status(404).json({ error: 'Payment not found' })
    return res.json({ success: true, payment })
  })

  // ── 4. Orders and the state machine ────────────────────────────────────────

  app.get('/api/orders/:id', requireAuth(), (req, res) => {
    const order = loadOrder(req, res)
    if (order) res.json({ success: true, order: publicOrder(order, sessionOf(res)) })
  })

  app.post('/api/orders/create', requireAuth('customer', 'admin'), (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const words = int(b.words, 'words', 1, 200_000)
    const q = calculateQuote({
      words,
      simpleDrawings: optInt(b.simpleDrawings, 'simpleDrawings', 0, 100),
      complexDrawings: optInt(b.complexDrawings, 'complexDrawings', 0, 100),
      graphs: optInt(b.graphs, 'graphs', 0, 100),
      customTemplate: b.customTemplate === undefined ? false : bool(b.customTemplate, 'customTemplate'),
    })

    const order: OrderDoc = {
      id: newOrderId(),
      customerPhone: s.phone,
      title: optStr(b.title, 'title', 120) ?? 'Manuscript Order',
      subject: optStr(b.subject, 'subject', 60) ?? 'General',
      status: 'Paid',
      customerTotal: q.customerTotal,
      scribePayout: q.scribeTotal,
      pages: q.pages,
      words,
      deliveryOtp: randomDigits(6),
      finalDeadline: computeDeadlines(q.pages).formattedFinalDeadline,
      timeline: [{ status: 'Paid', timestamp: new Date().toISOString(), note: 'Escrow payment locked in test gateway.' }],
    }
    dbOrders.push(order)
    return res.status(201).json({ success: true, order: publicOrder(order, s) })
  })

  app.post('/api/orders/:id/transition', requireAuth(), (req, res) => {
    const s = sessionOf(res)
    const order = loadOrder(req, res)
    if (!order) return
    const b = bodyOf(req)
    const next = oneOf<OrderStateEnum>(b.nextStatus, 'nextStatus', STATES)
    const note = optStr(b.note, 'note', 300)
    const me = scribeIdFor(s.phone)

    // Who may move an order where.
    if (s.role === 'scribe') {
      if (!SCRIBE_TARGETS.has(next)) return forbid(res)
      if (next === 'Accepted' ? order.scribeId && order.scribeId !== me : order.scribeId !== me) {
        return forbid(res, 'Only the assigned scribe can do this')
      }
    } else if (s.role === 'customer') {
      if (!CUSTOMER_TARGETS.has(next)) return forbid(res)
    }

    const check = validateTransition(order.status, next)
    if (!check.success) return res.status(400).json({ error: check.error })

    // Admins may assign a scribe by hand. Scribes assign themselves when they accept.
    let scribeId = order.scribeId
    if (s.role === 'scribe' && next === 'Accepted') scribeId = me
    if (s.role === 'admin' && b.scribeId !== undefined) scribeId = idLike(b.scribeId, 'scribeId')
    if ((next === 'Writing' || next === 'Delivered') && !scribeId) {
      return res.status(400).json({ error: 'Order has no assigned scribe yet' })
    }

    order.scribeId = scribeId
    order.scribeName = scribeId
    applyTransition(order, next, note ?? check.auditLog)
    return res.json({ success: true, order: publicOrder(order, s), audit: check.auditLog })
  })

  // ── 5. Rush check-ins and strikes ──────────────────────────────────────────

  app.post('/api/orders/:id/checkin', requireAuth('scribe', 'admin'), (req, res) => {
    const s = sessionOf(res)
    const order = loadOrder(req, res)
    if (!order) return
    if (s.role === 'scribe' && order.scribeId !== scribeIdFor(s.phone)) {
      return forbid(res, 'Only the assigned scribe can check in')
    }
    if (order.status !== 'Writing') {
      return res.status(400).json({ error: 'Check-in only permitted while in Writing status' })
    }

    const nextDue = computeNextCheckInDeadline()
    order.nextCheckInDue = nextDue.toISOString()
    globalScheduler.recordCheckIn(order.id, nextDue)
    order.timeline.push({
      status: 'Writing Check-in',
      timestamp: new Date().toISOString(),
      note: optStr(bodyOf(req).note, 'note', 300) ?? 'Hourly rush check-in verified. Timer reset.',
    })
    return res.json({ success: true, nextCheckInDue: nextDue.toISOString(), order: publicOrder(order, s) })
  })

  app.get('/api/scribes/:id/strikes', requireAuth('scribe', 'admin'), (req, res) => {
    const s = sessionOf(res)
    const id = idLike(req.params.id, 'scribe id')
    if (s.role === 'scribe' && id !== scribeIdFor(s.phone)) return forbid(res)
    return res.json({ success: true, strikes: globalScheduler.getScribeStrikeInfo(id) })
  })

  // ── 6. Scheduled jobs (platform cron or admin) ─────────────────────────────

  app.post('/api/cron/trigger-jobs', requireAdminOrCron, (req, res) => {
    const given = bodyOf(req).simulatedTimestamp
    // Simulating the clock would release escrow early, so it only works outside production.
    if (given !== undefined && isProduction()) return res.status(400).json({ error: 'simulatedTimestamp is not allowed in production' })
    const now = given === undefined ? new Date() : new Date(str(given, 'simulatedTimestamp', { max: 40 }))
    if (Number.isNaN(now.getTime())) throw new ValidationError('simulatedTimestamp is not a valid date')

    const escrowReleased = globalScheduler.runEscrowReleaseJob(now)
    const rushResults = globalScheduler.runRushMonitorJob(now)

    // A strike without taking the order away would leave a ghosting scribe assigned.
    for (const id of rushResults.reassignedOrderIds) {
      const order = dbOrders.find((o) => o.id === id)
      if (order && validateTransition(order.status, 'Reassigned').success) {
        order.scribeId = undefined
        order.scribeName = undefined
        order.nextCheckInDue = undefined
        applyTransition(order, 'Reassigned', 'Missed hourly check-in. Returned to the pool; restart from page 1.')
      }
    }

    return res.json({
      success: true,
      simulatedTime: now.toISOString(),
      escrowReleased,
      rushResults,
      auditLogs: globalScheduler.getAuditLogs().slice(-10),
    })
  })

  // ── 7. Courier logistics ───────────────────────────────────────────────────

  app.post('/api/logistics/dispatch', requireAuth('admin', 'scribe'), (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const orderId = idLike(b.orderId, 'orderId')
    const order = dbOrders.find((o) => o.id === orderId)
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (s.role === 'scribe' && order.scribeId !== scribeIdFor(s.phone)) return forbid(res, 'Only the assigned scribe can dispatch')

    const partner = b.partner === undefined ? undefined : oneOf(b.partner, 'partner', ['Borzo', 'Porter'] as const)
    const task = globalLogistics.createCourierDispatch(
      orderId,
      optStr(b.dropGate, 'dropGate', 120),
      optStr(b.pickupAddress, 'pickupAddress', 120),
      partner,
      order.deliveryOtp,
      order.customerPhone,
    )
    // The OTP goes to the customer only. Whoever dispatches must never see it.
    const { deliveryOtp: _otp, ...safeTask } = task
    return res.json({ success: true, task: safeTask })
  })

  app.post('/api/logistics/confirm-delivery', sensitiveLimit, requireAuth('customer', 'admin'), (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const orderId = idLike(b.orderId, 'orderId')
    const otp = str(b.deliveryOtp, 'deliveryOtp', { min: 4, max: 8 })
    const photo = b.gateDropPhotoUrl === undefined ? undefined : mediaUrl(b.gateDropPhotoUrl, 'gateDropPhotoUrl')
    const order = dbOrders.find((o) => o.id === orderId)
    if (!order || !canView(order, s)) return res.status(404).json({ error: 'Order not found' })

    if (deliveryAttempts.lockedForMs(orderId) > 0) {
      return res.status(429).json({ error: 'Too many wrong codes. Try again in 15 minutes.' })
    }
    const result = globalLogistics.confirmGateDelivery(orderId, otp, photo)
    if (!result.success) {
      if (result.error?.includes('Invalid Delivery OTP')) deliveryAttempts.fail(orderId)
      return res.status(400).json({ error: result.error })
    }
    deliveryAttempts.clear(orderId)

    // Handover is acceptance: this starts the 24-hour payout clock.
    if (order.status === 'Dispatched' && order.scribeId) {
      applyTransition(order, 'Delivered', 'Delivery OTP confirmed at the gate.')
    }
    const { deliveryOtp: _otp, ...safeTask } = result.task!
    return res.json({ success: true, task: safeTask })
  })

  // ── 8. Disputes and admin ──────────────────────────────────────────────────

  app.post('/api/disputes/file', sensitiveLimit, requireAuth('customer', 'admin'), (req, res) => {
    const s = sessionOf(res)
    const b = bodyOf(req)
    const orderId = idLike(b.orderId, 'orderId')
    const reason = oneOf('reason' in b ? b.reason : 'MISSING_PAGES', 'reason', [
      'ILLEGIBLE_HANDWRITING', 'MISSING_PAGES', 'DAMAGED_ENVELOPE', 'INCORRECT_DIAGRAMS', 'OTHER',
    ] as const)
    const video = mediaUrl(b.unboxingVideoUrl, 'unboxingVideoUrl')
    const notes = optStr(b.customerNotes, 'customerNotes', 1000) ?? ''
    const name = optStr(b.customerName, 'customerName', 80)

    const order = dbOrders.find((o) => o.id === orderId)
    if (!order || !canView(order, s)) return res.status(404).json({ error: 'Order not found' })
    if (order.status !== 'Delivered') return res.status(400).json({ error: 'A dispute can only be filed on a delivered order' })
    if (globalLogistics.getAllDisputes().some((d) => d.orderId === orderId && d.status === 'PENDING_REVIEW')) {
      return res.status(409).json({ error: 'A dispute is already open for this order' })
    }

    // Scribe and amount come from the order, never from the client.
    const dispute = globalLogistics.fileDispute(orderId, reason, video, notes, name, order.scribeId, order.customerTotal)
    globalScheduler.freezeEscrow(orderId)
    applyTransition(order, 'Disputed', `Dispute ${dispute.id} opened. Escrow frozen.`)
    return res.status(201).json({ success: true, dispute })
  })

  app.get('/api/admin/disputes', requireAuth('admin'), (_req, res) => {
    res.json({ success: true, disputes: globalLogistics.getAllDisputes() })
  })

  app.post('/api/admin/disputes/:id/resolve', requireAuth('admin'), (req, res) => {
    const b = bodyOf(req)
    const id = idLike(req.params.id, 'dispute id')
    const decision = oneOf('decision' in b ? b.decision : undefined, 'decision', [
      'REFUNDED_TO_CUSTOMER', 'RELEASED_TO_SCRIBE', 'SPLIT',
    ] as const)
    const adminNotes = optStr(b.adminNotes, 'adminNotes', 500) ?? 'Resolved'

    const existing = globalLogistics.getAllDisputes().find((d) => d.id === id)
    if (!existing) return res.status(404).json({ error: 'Dispute record not found' })
    if (existing.status !== 'PENDING_REVIEW') return res.status(409).json({ error: 'This dispute is already resolved' })

    const resolved = globalLogistics.resolveDispute(id, decision, adminNotes)
    globalScheduler.settleEscrow(existing.orderId, decision)
    const order = dbOrders.find((o) => o.id === existing.orderId)
    if (order && validateTransition(order.status, 'Closed').success) {
      applyTransition(order, 'Closed', `Dispute ${id} ruled ${decision}.`)
    }
    return res.json({ success: true, dispute: resolved })
  })

  app.get('/api/admin/scribes', requireAuth('admin'), (_req, res) => {
    res.json({ success: true, scribes: globalLogistics.getAllScribes() })
  })

  app.post('/api/admin/scribes/:id/verify', requireAuth('admin'), (req, res) => {
    const id = idLike(req.params.id, 'scribe id')
    const approved = bool(bodyOf(req).isApproved, 'isApproved')
    if (!globalLogistics.getAllScribes().some((x) => x.scribeId === id)) return res.status(404).json({ error: 'Scribe not found' })
    return res.json({ success: true, scribe: globalLogistics.verifyScribeCard(id, approved) })
  })

  app.post('/api/admin/scribes/:id/strikes', requireAuth('admin'), (req, res) => {
    const id = idLike(req.params.id, 'scribe id')
    const delta = int(bodyOf(req).delta ?? 1, 'delta', -5, 5)
    if (delta === 0) throw new ValidationError('delta cannot be 0')
    if (!globalLogistics.getAllScribes().some((x) => x.scribeId === id)) return res.status(404).json({ error: 'Scribe not found' })
    return res.json({ success: true, scribe: globalLogistics.manageScribeStrike(id, delta) })
  })

  app.get('/api/admin/notifications', requireAuth('admin'), (_req, res) => {
    res.json({ success: true, notifications: globalLogistics.getNotificationLogs() })
  })

  app.get('/api/health', (_req, res) => {
    res.json({ service: 'ScribeLink Core API', status: 'ok', phase: 7, timestamp: new Date().toISOString() })
  })

  // ── Fallbacks ──────────────────────────────────────────────────────────────

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message })
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

export const app = createApp()

if (process.env.NODE_ENV !== 'test') {
  assertProductionConfig()
  app.listen(PORT, () => {
    console.log(`[ScribeLink] API listening on port ${PORT}`)
  })
}
