/**
 * backend/server.ts
 * Express + TypeScript API server for ScribeLink (Phase 4 & 5):
 * - Phone OTP Login & Role Authentication
 * - Shared rules pricing engine & text inspection
 * - Enforced Order State Machine transitions & deadlines
 * - Payment Gateway (UPI Test Mode) with instant verification
 * - 24-hour Escrow Release Clock scheduler
 * - Rush Protocol: Hourly check-ins, auto-reassignment & strike management
 */

import express from 'express'
import cors from 'cors'
import {
  calculateQuote,
  checkCoverPage,
  countWords,
  sanitizeText,
  type OrderInput,
} from '../shared/rules'
import {
  validateTransition,
  computeDeadlines,
  computeIntakeDeadline,
  computeNextCheckInDeadline,
  type OrderStateEnum,
} from '../shared/stateMachine'
import { createUpiPaymentIntent, verifyUpiPayment, getPayment } from './paymentGateway'
import { globalScheduler } from './scheduler'

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

// ── In-Memory Database ───────────────────────────────────────────────────────

interface OrderDoc {
  id: string
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
    scribeName: 'Ananya R.',
    pages: 8,
    words: 1540,
    deliveryOtp: '7412',
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

// ── 1. Auth & OTP Endpoints ──────────────────────────────────────────────────

const activeOtps = new Map<string, { otp: string; expiresAt: number }>()

app.post('/api/auth/otp/send', (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ error: 'Phone number is required' })

  const otp = '123456'
  activeOtps.set(phone.trim(), { otp, expiresAt: Date.now() + 300000 })
  return res.json({
    success: true,
    message: `OTP sent to ${phone}. (Demo OTP: 123456)`,
    expiresInSeconds: 300,
  })
})

app.post('/api/auth/otp/verify', (req, res) => {
  const { phone, otp, requestedRole } = req.body
  const session = activeOtps.get(phone?.trim())
  if (!session || session.otp !== otp?.trim() || Date.now() > session.expiresAt) {
    return res.status(401).json({ error: 'Invalid or expired OTP' })
  }

  activeOtps.delete(phone.trim())
  return res.json({
    success: true,
    token: `sl_token_${Date.now()}`,
    user: {
      phone,
      role: requestedRole || 'customer',
      name: requestedRole === 'scribe' ? 'Ananya R.' : 'Student User',
    },
  })
})

// ── 2. Pricing & Heuristics (Shared Rules) ───────────────────────────────────

app.post('/api/pricing/quote', (req, res) => {
  const input: OrderInput = req.body
  const quote = calculateQuote(input)
  return res.json({ success: true, quote })
})

app.post('/api/text/analyze', (req, res) => {
  const { rawText } = req.body
  const clean = sanitizeText(rawText || '')
  const words = countWords(clean)
  const coverResult = checkCoverPage(clean)
  return res.json({
    success: true,
    words,
    coverPageWarning: coverResult.warning,
    detectedKeywords: coverResult.matches,
  })
})

// ── 3. Phase 5: Payment Gateway (UPI Test Mode) ──────────────────────────────

app.post('/api/payment/upi/initiate', (req, res) => {
  const { orderId, amount, payerVpa } = req.body
  if (!orderId || !amount) {
    return res.status(400).json({ error: 'orderId and amount are required' })
  }

  const intent = createUpiPaymentIntent(orderId, amount, payerVpa || 'student@upi')
  return res.json({ success: true, payment: intent })
})

app.post('/api/payment/upi/verify', (req, res) => {
  const { paymentId, forceSuccess } = req.body
  try {
    const result = verifyUpiPayment(paymentId, forceSuccess ?? true)
    return res.json(result)
  } catch (err: any) {
    return res.status(404).json({ error: err.message })
  }
})

app.get('/api/payment/:id', (req, res) => {
  const payment = getPayment(req.params.id)
  if (!payment) return res.status(404).json({ error: 'Payment not found' })
  return res.json({ success: true, payment })
})

// ── 4. Phase 5: Enforced Order State Machine Transitions ─────────────────────

app.get('/api/orders/:id', (req, res) => {
  const order = dbOrders.find(o => o.id === req.params.id)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  return res.json({ success: true, order })
})

app.post('/api/orders/create', (req, res) => {
  const { title, subject, words, simpleDrawings, complexDrawings, graphs, customTemplate } = req.body
  const q = calculateQuote({
    words: words || 0,
    simpleDrawings: simpleDrawings || 0,
    complexDrawings: complexDrawings || 0,
    graphs: graphs || 0,
    customTemplate: Boolean(customTemplate),
  })

  const deadlines = computeDeadlines(q.pages)
  const newOrder: OrderDoc = {
    id: `SL-${Math.floor(1000 + Math.random() * 9000)}`,
    title: title || 'Manuscript Order',
    subject: subject || 'General',
    status: 'Paid',
    customerTotal: q.customerTotal,
    scribePayout: q.scribeTotal,
    pages: q.pages,
    words: words || 0,
    deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
    finalDeadline: deadlines.formattedFinalDeadline,
    timeline: [
      { status: 'Paid', timestamp: 'Just now', note: 'Escrow payment locked in test gateway.' },
    ],
  }

  dbOrders.push(newOrder)
  return res.status(201).json({ success: true, order: newOrder })
})

/** Transition enforcing state machine rules */
app.post('/api/orders/:id/transition', (req, res) => {
  const { nextStatus, note, scribeId, scribeName } = req.body
  const order = dbOrders.find(o => o.id === req.params.id)
  if (!order) return res.status(404).json({ error: 'Order not found' })

  // Validate state machine rule
  const validation = validateTransition(order.status, nextStatus)
  if (!validation.success) {
    return res.status(400).json({ error: validation.error })
  }

  order.status = nextStatus
  if (scribeId) order.scribeId = scribeId
  if (scribeName) order.scribeName = scribeName

  // Handle specialized state machine triggers
  if (nextStatus === 'Accepted') {
    const intakeLimit = computeIntakeDeadline()
    order.intakeDeadline = intakeLimit.toISOString()
  } else if (nextStatus === 'Writing') {
    const nextCheckIn = computeNextCheckInDeadline()
    order.nextCheckInDue = nextCheckIn.toISOString()
    globalScheduler.registerRushWatch(order.id, order.scribeId || 'S-2041', order.scribeName || 'Scribe', nextCheckIn)
  } else if (nextStatus === 'Delivered') {
    // Phase 5: Start 24-hour Escrow Payout Clock
    globalScheduler.registerEscrowClock(order.id, order.scribeId || 'S-2041', order.scribePayout)
  }

  order.timeline.push({
    status: nextStatus,
    timestamp: new Date().toLocaleTimeString(),
    note: note || validation.auditLog,
  })

  return res.json({ success: true, order, audit: validation.auditLog })
})

// ── 5. Phase 5: Rush Check-ins & Strike Management ───────────────────────────

app.post('/api/orders/:id/checkin', (req, res) => {
  const { note } = req.body
  const order = dbOrders.find(o => o.id === req.params.id)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  if (order.status !== 'Writing') {
    return res.status(400).json({ error: 'Check-in only permitted while in Writing status' })
  }

  const nextDue = computeNextCheckInDeadline()
  order.nextCheckInDue = nextDue.toISOString()
  globalScheduler.recordCheckIn(order.id, nextDue)

  order.timeline.push({
    status: 'Writing Check-in',
    timestamp: new Date().toLocaleTimeString(),
    note: note || 'Hourly rush check-in verified. Timer reset.',
  })

  return res.json({ success: true, nextCheckInDue: nextDue.toISOString(), order })
})

app.get('/api/scribes/:id/strikes', (req, res) => {
  const strikes = globalScheduler.getScribeStrikeInfo(req.params.id)
  return res.json({ success: true, strikes })
})

// ── 6. Scheduled Job Runner Endpoint (for Cron/Testing) ──────────────────────

app.post('/api/cron/trigger-jobs', (req, res) => {
  const simulatedTime = req.body.simulatedTimestamp ? new Date(req.body.simulatedTimestamp) : new Date()
  const escrowReleased = globalScheduler.runEscrowReleaseJob(simulatedTime)
  const rushResults = globalScheduler.runRushMonitorJob(simulatedTime)

  return res.json({
    success: true,
    simulatedTime: simulatedTime.toISOString(),
    escrowReleased,
    rushResults,
    auditLogs: globalScheduler.getAuditLogs().slice(-10),
  })
})

// ── 7. Phase 6: Courier Logistics (Porter / Borzo) ───────────────────────────

import { globalLogistics } from './logisticsService'

app.post('/api/logistics/dispatch', (req, res) => {
  const { orderId, dropGate, pickupAddress, partner } = req.body
  if (!orderId) return res.status(400).json({ error: 'orderId is required' })

  const task = globalLogistics.createCourierDispatch(orderId, dropGate, pickupAddress, partner)
  return res.json({ success: true, task })
})

app.post('/api/logistics/confirm-delivery', (req, res) => {
  const { orderId, deliveryOtp, gateDropPhotoUrl } = req.body
  const result = globalLogistics.confirmGateDelivery(orderId, deliveryOtp, gateDropPhotoUrl)
  if (!result.success) return res.status(400).json({ error: result.error })
  return res.json({ success: true, task: result.task })
})

// ── 8. Phase 6: Unboxing Video Disputes & Admin Panel ────────────────────────

app.post('/api/disputes/file', (req, res) => {
  const { orderId, reason, unboxingVideoUrl, customerNotes, customerName, scribeId, amount } = req.body
  if (!orderId || !unboxingVideoUrl) {
    return res.status(400).json({ error: 'orderId and unboxingVideoUrl are required' })
  }

  const dispute = globalLogistics.fileDispute(
    orderId,
    reason || 'MISSING_PAGES',
    unboxingVideoUrl,
    customerNotes,
    customerName,
    scribeId,
    amount
  )
  return res.json({ success: true, dispute })
})

app.get('/api/admin/disputes', (_req, res) => {
  res.json({ success: true, disputes: globalLogistics.getAllDisputes() })
})

app.post('/api/admin/disputes/:id/resolve', (req, res) => {
  const { decision, adminNotes } = req.body
  try {
    const resolved = globalLogistics.resolveDispute(req.params.id, decision, adminNotes || 'Resolved')
    return res.json({ success: true, dispute: resolved })
  } catch (err: any) {
    return res.status(404).json({ error: err.message })
  }
})

app.get('/api/admin/scribes', (_req, res) => {
  res.json({ success: true, scribes: globalLogistics.getAllScribes() })
})

app.post('/api/admin/scribes/:id/verify', (req, res) => {
  const { isApproved } = req.body
  const updated = globalLogistics.verifyScribeCard(req.params.id, Boolean(isApproved))
  return res.json({ success: true, scribe: updated })
})

app.post('/api/admin/scribes/:id/strikes', (req, res) => {
  const { delta } = req.body
  const updated = globalLogistics.manageScribeStrike(req.params.id, Number(delta) || 1)
  return res.json({ success: true, scribe: updated })
})

app.get('/api/admin/notifications', (_req, res) => {
  res.json({ success: true, notifications: globalLogistics.getNotificationLogs() })
})

app.get('/api/health', (_req, res) => {
  res.json({
    service: 'ScribeLink Core API & State Machine',
    status: 'ok',
    phase: 6,
    timestamp: new Date().toISOString(),
  })
})

export { app }

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[ScribeLink Backend] Phase 5 API running at http://localhost:${PORT}`)
  })
}
