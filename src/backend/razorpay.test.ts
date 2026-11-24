import './testSetup'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import type { Server } from 'node:http'
import { createApp } from './server'
import { testDb } from './testDb'
import { setFetcher, verifyCheckoutSignature, verifyWebhookSignature } from './razorpay'

const sign = (secret: string, data: string | Buffer) => crypto.createHmac('sha256', secret).update(data).digest('hex')
const GATE = { college: 'DTU', line: 'Main Gate 1', pincode: '110042', contactName: 'Riya', contactPhone: '+919876500001' }

describe('signature checks', () => {
  test('a checkout signature must be made with our secret from the order and payment ids', () => {
    const good = sign('sec', 'order_1|pay_1')
    assert.equal(verifyCheckoutSignature('order_1', 'pay_1', good, 'sec'), true)
    assert.equal(verifyCheckoutSignature('order_1', 'pay_2', good, 'sec'), false, 'different payment')
    assert.equal(verifyCheckoutSignature('order_1', 'pay_1', good, 'other'), false, 'different secret')
    assert.equal(verifyCheckoutSignature('order_1', 'pay_1', 'short', 'sec'), false, 'wrong length does not throw')
  })

  test('a webhook signature covers the exact body', () => {
    const body = Buffer.from('{"event":"payment.captured"}')
    assert.equal(verifyWebhookSignature(body, sign('wh', body), 'wh'), true)
    assert.equal(verifyWebhookSignature(Buffer.from('{"event":"payment.captured" }'), sign('wh', body), 'wh'), false)
  })
})

describe('Razorpay payments end to end (network faked)', () => {
  let server: Server
  let base = ''
  const KEY = { RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'keysecret', RAZORPAY_WEBHOOK_SECRET: 'whsecret', PAYMENT_PROVIDER: 'razorpay' }
  const calls: Array<{ url: string; body: any }> = []

  const call = async (method: string, path: string, o: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(o.raw === undefined ? { 'Content-Type': 'application/json' } : {}), ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...o.headers },
      body: o.raw ?? (o.body ? JSON.stringify(o.body) : undefined),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }
  const login = async (phone: string, role: string) => {
    const sent = await call('POST', '/api/auth/otp/send', { body: { phone } })
    const ok = await call('POST', '/api/auth/otp/verify', { body: { phone, otp: sent.body.devOtp, requestedRole: role } })
    assert.equal(ok.status, 200)
    return ok.body.token as string
  }
  const webhook = (event: unknown, secret = KEY.RAZORPAY_WEBHOOK_SECRET) => {
    const raw = JSON.stringify(event)
    return call('POST', '/api/payment/razorpay/webhook', { raw, headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sign(secret, raw) } })
  }

  before(async () => {
    Object.assign(process.env, KEY)
    setFetcher(async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, body })
      return { ok: true, status: 200, json: async () => (url.endsWith('/orders') ? { id: 'order_RZP1' } : { id: 'rfnd_1' }) }
    })
    const db = await testDb()
    server = await new Promise<Server>((resolve) => { const s = createApp(db).listen(0, () => resolve(s)) })
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  after(() => { for (const k of Object.keys(KEY)) delete process.env[k]; server.closeAllConnections(); server.close() })

  test('pay, get refunded on cancel, and the webhook confirms the refund', async () => {
    const cust = await login('+919876543001', 'customer')
    const admin = await login('+919000000001', 'admin')
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id

    // The test gateway is off when Razorpay is the provider.
    assert.equal((await call('POST', '/api/payment/upi/initiate', { token: cust, body: { orderId: id, amount: 300 } })).status, 503)

    const started = await call('POST', '/api/payment/razorpay/order', { token: cust, body: { orderId: id } })
    assert.equal(started.status, 200)
    assert.equal(started.body.rzpOrderId, 'order_RZP1')
    assert.equal(calls[0].body.amount, 30000, 'the server sets the price, in paise')

    // A forged checkout signature does not mark the order paid.
    const forged = await call('POST', '/api/payment/razorpay/verify', { token: cust, body: { paymentId: started.body.paymentId, razorpayPaymentId: 'pay_9', razorpaySignature: 'x'.repeat(64) } })
    assert.equal(forged.status, 400)
    assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.status, 'Draft')

    // The webhook with the wrong secret is refused; with the right one it marks the order Paid.
    const captured = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_9', order_id: 'order_RZP1', amount: 30000 } } } }
    assert.equal((await webhook(captured, 'wrong')).status, 400)
    assert.equal((await webhook({ ...captured, payload: { payment: { entity: { id: 'pay_9', order_id: 'order_RZP1', amount: 100 } } } })).status, 200)
    assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.status, 'Draft', 'wrong amount ignored')
    assert.equal((await webhook(captured)).status, 200)
    assert.equal((await webhook(captured)).status, 200, 'delivered twice is fine')
    assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.status, 'Paid')

    // Cancelling starts a PENDING refund. The next job run sends it to Razorpay.
    await call('POST', `/api/orders/${id}/transition`, { token: cust, body: { nextStatus: 'Cancelled' } })
    assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.refund.status, 'PENDING')
    const run = await call('POST', '/api/cron/trigger-jobs', { token: admin, body: {} })
    assert.equal(run.body.refundsSent.sent, 1)
    const sent = calls.find((c) => c.url.endsWith('/payments/pay_9/refund'))
    assert.equal(sent?.body.amount, 30000)
    assert.equal((await call('POST', '/api/cron/trigger-jobs', { token: admin, body: {} })).body.refundsSent.sent, 0, 'not sent twice')

    // Razorpay confirms.
    assert.equal((await webhook({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1' } } } })).status, 200)
    assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.refund.status, 'PROCESSED')
  })
})
