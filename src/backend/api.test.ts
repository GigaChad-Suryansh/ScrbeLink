import './testSetup'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from './server'
import { globalScheduler } from './scheduler'
import { scribeIdFor, signSession } from './security'

// ── Test client ──────────────────────────────────────────────────────────────

interface Reply { status: number; body: any; headers: Headers }

function startServer(): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createApp().listen(0, () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }))
  })
}

const close = (s: Server) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()) })

function client(base: string) {
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}): Promise<Reply> => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(opts.raw !== undefined || opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      body: method === 'GET' ? undefined : (opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body))),
    })
    const text = await res.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: res.status, body, headers: res.headers }
  }
  /** Signs in through the real OTP flow. */
  const login = async (phone: string, role: 'customer' | 'scribe' | 'admin' = 'customer'): Promise<string> => {
    const sent = await call('POST', '/api/auth/otp/send', { body: { phone } })
    assert.equal(sent.status, 200, 'otp send')
    const ok = await call('POST', '/api/auth/otp/verify', { body: { phone, otp: sent.body.devOtp, requestedRole: role } })
    assert.equal(ok.status, 200, `otp verify: ${JSON.stringify(ok.body)}`)
    return ok.body.token
  }
  return { call, login }
}

const ADMIN = '+919000000001'
const CUSTOMER_A = '+919000000010'
const CUSTOMER_B = '+919000000011'
const SCRIBE_1 = '+919000000020'
const SCRIBE_2 = '+919000000021'
const VIDEO = 'https://storage.scribelink.in/unboxing/test.mp4'

// ── Main suite: one server, five sign-ins (the OTP limit is 5 per 15 minutes) ─

describe('API', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>
  let api: ReturnType<typeof client>
  let admin: string, custA: string, custB: string, scribe1: string, scribe2: string

  before(async () => {
    ctx = await startServer()
    api = client(ctx.base)
    admin = await api.login(ADMIN, 'admin')
    custA = await api.login(CUSTOMER_A)
    custB = await api.login(CUSTOMER_B)
    scribe1 = await api.login(SCRIBE_1, 'scribe')
    scribe2 = await api.login(SCRIBE_2, 'scribe')
  })
  after(() => close(ctx.server))

  describe('basics', () => {
    test('health is public, and security headers are set', async () => {
      const r = await api.call('GET', '/api/health')
      assert.equal(r.status, 200)
      assert.equal(r.body.status, 'ok')
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(r.headers.get('x-powered-by'), null)
    })

    test('malformed JSON is a 400, not a crash', async () => {
      const r = await api.call('POST', '/api/pricing/quote', { raw: '{ not json' })
      assert.equal(r.status, 400)
      assert.ok(r.body.error)
    })

    test('oversized bodies are refused', async () => {
      const r = await api.call('POST', '/api/text/analyze', { body: { rawText: 'a'.repeat(1_100_000) } })
      assert.equal(r.status, 413)
    })

    test('unknown API routes return JSON 404', async () => {
      const r = await api.call('GET', '/api/nope')
      assert.equal(r.status, 404)
      assert.equal(r.body.error, 'Not found')
    })

    test('pricing quote works and validates input', async () => {
      const ok = await api.call('POST', '/api/pricing/quote', { body: { words: 1200, simpleDrawings: 2, complexDrawings: 1, graphs: 1, customTemplate: true } })
      assert.equal(ok.status, 200)
      assert.equal(ok.body.quote.pages, 6)
      for (const body of [{ words: '1200' }, { words: -1 }, { words: 1.5 }, { words: 1e9 }, {}, { words: 100, graphs: 'x' }]) {
        assert.equal((await api.call('POST', '/api/pricing/quote', { body })).status, 400, JSON.stringify(body))
      }
    })

    test('text analysis flags cover-page details', async () => {
      const r = await api.call('POST', '/api/text/analyze', { body: { rawText: 'Roll No: 19/EC/201 Department of Electrical Engineering University Exam' } })
      assert.equal(r.status, 200)
      assert.equal(r.body.coverPageWarning, true)
      assert.equal((await api.call('POST', '/api/text/analyze', { body: {} })).status, 400)
    })
  })

  describe('authentication', () => {
    test('protected routes need a token', async () => {
      const routes: [string, string][] = [
        ['GET', '/api/orders/SL-7412'], ['POST', '/api/orders/create'], ['POST', '/api/orders/SL-7412/transition'],
        ['GET', '/api/admin/disputes'], ['GET', '/api/admin/scribes'], ['GET', '/api/admin/notifications'],
        ['POST', '/api/admin/scribes/S-1/strikes'], ['POST', '/api/cron/trigger-jobs'], ['POST', '/api/payment/upi/initiate'],
        ['POST', '/api/logistics/dispatch'], ['POST', '/api/disputes/file'], ['GET', '/api/scribes/S-1/strikes'],
      ]
      for (const [m, p] of routes) assert.equal((await api.call(m, p, { body: {} })).status, 401, `${m} ${p}`)
    })

    test('a customer or scribe cannot use admin routes', async () => {
      for (const token of [custA, scribe1]) {
        assert.equal((await api.call('GET', '/api/admin/disputes', { token })).status, 403)
        assert.equal((await api.call('POST', '/api/cron/trigger-jobs', { token, body: {} })).status, 403)
        assert.equal((await api.call('POST', '/api/admin/scribes/S-1/strikes', { token, body: { delta: 1 } })).status, 403)
      }
      assert.equal((await api.call('GET', '/api/admin/disputes', { token: admin })).status, 200)
    })

    test('nobody can request admin unless their number is on the allowlist', async () => {
      const phone = '+919000000099'
      const sent = await api.call('POST', '/api/auth/otp/send', { body: { phone } }).catch(() => null)
      // The OTP limit may already be used up by sign-ins above; the role check runs before any code is checked.
      const r = await api.call('POST', '/api/auth/otp/verify', { body: { phone, otp: sent?.body?.devOtp ?? '000000', requestedRole: 'admin' } })
      assert.equal(r.status, 403)
    })

    test('forged and tampered tokens are rejected', async () => {
      const [payload] = custA.split('.')
      const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'admin' })).toString('base64url')
      const [, sig] = custA.split('.')
      assert.equal((await api.call('GET', '/api/admin/disputes', { token: `${forgedPayload}.${sig}` })).status, 401)
      assert.equal((await api.call('GET', '/api/admin/disputes', { token: 'sl_token_123' })).status, 401)
      const expired = signSession({ phone: ADMIN, role: 'admin' }, 60, Date.now() - 3_600_000)
      assert.equal((await api.call('GET', '/api/admin/disputes', { token: expired })).status, 401)
    })

    test('the cron secret works instead of an admin token', async () => {
      const ok = await api.call('POST', '/api/cron/trigger-jobs', { body: {}, headers: { 'x-cron-secret': 'cron-secret-for-tests-only' } })
      assert.equal(ok.status, 200)
      const bad = await api.call('POST', '/api/cron/trigger-jobs', { body: {}, headers: { 'x-cron-secret': 'wrong' } })
      assert.equal(bad.status, 401)
    })

    test('the login code is not a fixed value', async () => {
      // Every code issued so far came from the response; a hardcoded 123456 must not work for someone who never asked for one.
      const r = await api.call('POST', '/api/auth/otp/verify', { body: { phone: '+919000000098', otp: '123456' } })
      assert.equal(r.status, 401)
    })
  })

  describe('order lifecycle, ownership and the delivery OTP', () => {
    let orderId = ''
    let otp = ''

    test('a customer creates an order and sees their own delivery OTP', async () => {
      const r = await api.call('POST', '/api/orders/create', { token: custA, body: { title: 'Physics', subject: 'Physics', words: 1000 } })
      assert.equal(r.status, 201)
      orderId = r.body.order.id
      otp = r.body.order.deliveryOtp
      assert.match(orderId, /^SL-\d{4}$/)
      assert.match(otp, /^\d{6}$/)
      assert.equal(r.body.order.customerTotal, 150)
      assert.equal(r.body.order.customerPhone, undefined, 'phone number is never exposed')
    })

    test('order creation validates input', async () => {
      for (const body of [{}, { words: 0 }, { words: 'many' }, { words: 100, title: 'x'.repeat(200) }, { words: 100, customTemplate: 'yes' }]) {
        assert.equal((await api.call('POST', '/api/orders/create', { token: custA, body })).status, 400, JSON.stringify(body))
      }
      assert.equal((await api.call('POST', '/api/orders/create', { token: scribe1, body: { words: 100 } })).status, 403, 'scribes cannot place orders')
    })

    test('another customer cannot see the order', async () => {
      assert.equal((await api.call('GET', `/api/orders/${orderId}`, { token: custB })).status, 404)
    })

    test('a scribe sees the order but never the OTP or the owner', async () => {
      const r = await api.call('GET', `/api/orders/${orderId}`, { token: scribe1 })
      assert.equal(r.status, 200)
      assert.equal(r.body.order.deliveryOtp, undefined)
      assert.equal(r.body.order.customerPhone, undefined)
    })

    test('a customer cannot move the order through scribe steps', async () => {
      assert.equal((await api.call('POST', `/api/orders/${orderId}/transition`, { token: custA, body: { nextStatus: 'Accepted' } })).status, 403)
      assert.equal((await api.call('POST', `/api/orders/${orderId}/transition`, { token: custA, body: { nextStatus: 'Delivered' } })).status, 403)
    })

    test('illegal jumps are rejected even for the right role', async () => {
      const r = await api.call('POST', `/api/orders/${orderId}/transition`, { token: scribe1, body: { nextStatus: 'Dispatched' } })
      assert.equal(r.status, 403, 'not the assigned scribe yet')
      const r2 = await api.call('POST', `/api/orders/${orderId}/transition`, { token: admin, body: { nextStatus: 'Dispatched' } })
      assert.equal(r2.status, 400)
      assert.match(r2.body.error, /Illegal state transition/)
    })

    test('a scribe accepts, and gets a pseudonymous ID', async () => {
      const r = await api.call('POST', `/api/orders/${orderId}/transition`, { token: scribe1, body: { nextStatus: 'Accepted' } })
      assert.equal(r.status, 200)
      assert.equal(r.body.order.scribeId, scribeIdFor(SCRIBE_1))
      assert.ok(!JSON.stringify(r.body).includes(SCRIBE_1), 'phone number never appears')
    })

    test('a second scribe cannot take over or check in', async () => {
      assert.equal((await api.call('POST', `/api/orders/${orderId}/transition`, { token: scribe2, body: { nextStatus: 'Writing' } })).status, 403)
      assert.equal((await api.call('POST', `/api/orders/${orderId}/transition`, { token: scribe2, body: { nextStatus: 'Accepted' } })).status, 403)
    })

    test('the assigned scribe writes, checks in, and dispatches', async () => {
      assert.equal((await api.call('POST', `/api/orders/${orderId}/transition`, { token: scribe1, body: { nextStatus: 'Writing' } })).status, 200)
      assert.equal((await api.call('POST', `/api/orders/${orderId}/checkin`, { token: scribe1, body: {} })).status, 200)
      assert.equal((await api.call('POST', `/api/orders/${orderId}/checkin`, { token: scribe2, body: {} })).status, 403)
      assert.equal((await api.call('POST', `/api/orders/${orderId}/checkin`, { token: custA, body: {} })).status, 403)
      assert.equal((await api.call('POST', `/api/orders/${orderId}/transition`, { token: scribe1, body: { nextStatus: 'Dispatched' } })).status, 200)
    })

    test('dispatch is limited to the assigned scribe and never returns the OTP', async () => {
      assert.equal((await api.call('POST', '/api/logistics/dispatch', { token: scribe2, body: { orderId } })).status, 403)
      assert.equal((await api.call('POST', '/api/logistics/dispatch', { token: scribe1, body: { orderId, partner: 'Nope' } })).status, 400)
      const r = await api.call('POST', '/api/logistics/dispatch', { token: scribe1, body: { orderId, partner: 'Porter', dropGate: 'Main gate' } })
      assert.equal(r.status, 200)
      assert.equal(r.body.task.deliveryOtp, undefined)
      assert.ok(!JSON.stringify(r.body).includes(otp))
    })

    test('the customer confirms with their OTP and the payout clock starts', async () => {
      const wrong = await api.call('POST', '/api/logistics/confirm-delivery', { token: custA, body: { orderId, deliveryOtp: otp === '000000' ? '111111' : '000000' } })
      assert.equal(wrong.status, 400)
      assert.equal((await api.call('POST', '/api/logistics/confirm-delivery', { token: custB, body: { orderId, deliveryOtp: otp } })).status, 404)
      assert.equal((await api.call('POST', '/api/logistics/confirm-delivery', { token: custA, body: { orderId, deliveryOtp: otp, gateDropPhotoUrl: 'http://127.0.0.1/x.jpg' } })).status, 400)

      const ok = await api.call('POST', '/api/logistics/confirm-delivery', { token: custA, body: { orderId, deliveryOtp: otp } })
      assert.equal(ok.status, 200)
      const order = await api.call('GET', `/api/orders/${orderId}`, { token: custA })
      assert.equal(order.body.order.status, 'Delivered')
      assert.equal(globalScheduler.getEscrowRecord(orderId)?.isReleased, false)
    })

    test('dispute evidence must be a public https link', async () => {
      for (const unboxingVideoUrl of ['http://storage.scribelink.in/a.mp4', 'https://localhost/a.mp4', 'https://10.0.0.5/a.mp4', 'file:///etc/passwd', undefined]) {
        const r = await api.call('POST', '/api/disputes/file', { token: custA, body: { orderId, reason: 'MISSING_PAGES', unboxingVideoUrl } })
        assert.equal(r.status, 400, String(unboxingVideoUrl))
      }
      assert.equal((await api.call('POST', '/api/disputes/file', { token: custA, body: { orderId, reason: 'BECAUSE', unboxingVideoUrl: VIDEO } })).status, 400)
      assert.equal((await api.call('POST', '/api/disputes/file', { token: custB, body: { orderId, reason: 'MISSING_PAGES', unboxingVideoUrl: VIDEO } })).status, 404)
    })

    let disputeId = ''
    test('filing a dispute freezes the scribe payout', async () => {
      const r = await api.call('POST', '/api/disputes/file', {
        token: custA,
        body: { orderId, reason: 'MISSING_PAGES', unboxingVideoUrl: VIDEO, customerNotes: 'Pages 3 and 4 missing', scribeId: 'S-FORGED', amount: 1 },
      })
      assert.equal(r.status, 201)
      disputeId = r.body.dispute.id
      assert.equal(r.body.dispute.scribeId, scribeIdFor(SCRIBE_1), 'scribe comes from the order, not the request')
      assert.equal(r.body.dispute.amount, 150, 'amount comes from the order, not the request')
      assert.equal(globalScheduler.getEscrowRecord(orderId)?.isDisputed, true)
      assert.equal((await api.call('GET', `/api/orders/${orderId}`, { token: custA })).body.order.status, 'Disputed')
      assert.equal((await api.call('POST', '/api/disputes/file', { token: custA, body: { orderId, reason: 'OTHER', unboxingVideoUrl: VIDEO } })).status, 400, 'no second dispute once Disputed')
    })

    test('the 24-hour job does not pay a frozen order', async () => {
      const later = new Date(Date.now() + 25 * 3_600_000).toISOString()
      const r = await api.call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: later } })
      assert.equal(r.status, 200)
      assert.equal(globalScheduler.getEscrowRecord(orderId)?.isReleased, false)
    })

    test('an admin refund keeps the money from the scribe and closes the order', async () => {
      assert.equal((await api.call('POST', `/api/admin/disputes/${disputeId}/resolve`, { token: admin, body: { decision: 'WHATEVER' } })).status, 400)
      const r = await api.call('POST', `/api/admin/disputes/${disputeId}/resolve`, { token: admin, body: { decision: 'REFUNDED_TO_CUSTOMER', adminNotes: 'Video shows missing pages' } })
      assert.equal(r.status, 200)
      assert.equal((await api.call('POST', `/api/admin/disputes/${disputeId}/resolve`, { token: admin, body: { decision: 'RELEASED_TO_SCRIBE' } })).status, 409, 'cannot be re-ruled')
      const later = new Date(Date.now() + 72 * 3_600_000).toISOString()
      await api.call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: later } })
      assert.equal(globalScheduler.getEscrowRecord(orderId)?.isReleased, false)
      assert.equal((await api.call('GET', `/api/orders/${orderId}`, { token: custA })).body.order.status, 'Closed')
    })
  })

  describe('an undisputed delivery', () => {
    test('pays the scribe after 24 hours', async () => {
      const created = await api.call('POST', '/api/orders/create', { token: admin, body: { words: 400 } })
      const id = created.body.order.id
      const step = (nextStatus: string, extra = {}) => api.call('POST', `/api/orders/${id}/transition`, { token: admin, body: { nextStatus, ...extra } })
      assert.equal((await step('Accepted', { scribeId: 'S-TESTAA' })).status, 200)
      assert.equal((await step('Writing')).status, 200)
      assert.equal((await step('Dispatched')).status, 200)
      assert.equal((await step('Delivered')).status, 200)

      const early = await api.call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 23 * 3_600_000).toISOString() } })
      assert.equal(globalScheduler.getEscrowRecord(id)?.isReleased, false, `released too early: ${JSON.stringify(early.body.escrowReleased)}`)
      await api.call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 25 * 3_600_000).toISOString() } })
      assert.equal(globalScheduler.getEscrowRecord(id)?.isReleased, true)
    })
  })

  describe('rush protocol', () => {
    test('a missed check-in strikes the scribe and takes the order away', async () => {
      const id = (await api.call('POST', '/api/orders/create', { token: admin, body: { words: 400 } })).body.order.id
      const step = (nextStatus: string, extra = {}) => api.call('POST', `/api/orders/${id}/transition`, { token: admin, body: { nextStatus, ...extra } })
      await step('Accepted', { scribeId: 'S-GHOST1' })
      await step('Writing')

      const later = new Date(Date.now() + 3 * 3_600_000).toISOString()
      const r = await api.call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: later } })
      assert.ok(r.body.rushResults.reassignedOrderIds.includes(id))

      const order = (await api.call('GET', `/api/orders/${id}`, { token: admin })).body.order
      assert.equal(order.status, 'Reassigned')
      assert.equal(order.scribeId, undefined)
      assert.equal((await api.call('GET', '/api/scribes/S-GHOST1/strikes', { token: admin })).body.strikes.strikes, 1)
      assert.equal((await step('Accepted', { scribeId: 'S-NEWONE' })).status, 200, 'another scribe can pick it up')
    })

    test('scribes can only read their own strikes', async () => {
      assert.equal((await api.call('GET', `/api/scribes/${scribeIdFor(SCRIBE_1)}/strikes`, { token: scribe1 })).status, 200)
      assert.equal((await api.call('GET', `/api/scribes/${scribeIdFor(SCRIBE_1)}/strikes`, { token: scribe2 })).status, 403)
    })
  })

  describe('payments (test mode)', () => {
    let orderId = ''
    test('the server decides the price', async () => {
      orderId = (await api.call('POST', '/api/orders/create', { token: custA, body: { words: 1000 } })).body.order.id
      const cheap = await api.call('POST', '/api/payment/upi/initiate', { token: custA, body: { orderId, amount: 1 } })
      assert.equal(cheap.status, 400)
      for (const amount of ['150', -150, 0, 1e12, null]) {
        assert.equal((await api.call('POST', '/api/payment/upi/initiate', { token: custA, body: { orderId, amount } })).status, 400, String(amount))
      }
      assert.equal((await api.call('POST', '/api/payment/upi/initiate', { token: custA, body: { orderId: 'SL-1"><svg', amount: 150 } })).status, 400)
      assert.equal((await api.call('POST', '/api/payment/upi/initiate', { token: custA, body: { orderId, amount: 150, payerVpa: 'bad vpa' } })).status, 400)
    })

    test("another customer cannot pay for or read someone else's payment", async () => {
      assert.equal((await api.call('POST', '/api/payment/upi/initiate', { token: custB, body: { orderId, amount: 150 } })).status, 404)
      const ok = await api.call('POST', '/api/payment/upi/initiate', { token: custA, body: { orderId, amount: 150, payerVpa: 'me@okbank' } })
      assert.equal(ok.status, 200)
      const pid = ok.body.payment.paymentId
      assert.equal((await api.call('GET', `/api/payment/${pid}`, { token: custB })).status, 404)
      assert.equal((await api.call('POST', '/api/payment/upi/verify', { token: custB, body: { paymentId: pid } })).status, 404)
      assert.equal((await api.call('POST', '/api/payment/upi/verify', { token: custA, body: { paymentId: pid } })).status, 200)
    })
  })

  describe('production safety switches', () => {
    const saved = process.env.NODE_ENV
    const asProduction = async (fn: () => Promise<void>) => {
      process.env.NODE_ENV = 'production'
      try { await fn() } finally { process.env.NODE_ENV = saved }
    }

    test('no fake payments in production', async () => {
      await asProduction(async () => {
        assert.equal((await api.call('POST', '/api/payment/upi/initiate', { token: custA, body: { orderId: 'SL-7412', amount: 248 } })).status, 503)
        assert.equal((await api.call('POST', '/api/payment/upi/verify', { token: custA, body: { paymentId: 'PAY-1' } })).status, 503)
      })
    })

    test('the clock cannot be simulated in production', async () => {
      await asProduction(async () => {
        const r = await api.call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 99 * 3_600_000).toISOString() } })
        assert.equal(r.status, 400)
      })
    })
  })
})

// ── Separate servers, so their limits start clean ────────────────────────────

describe('abuse protection', () => {
  test('no login codes are handed out in production without a real SMS provider', async () => {
    const { base, server } = await startServer()
    const saved = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const r = await client(base).call('POST', '/api/auth/otp/send', { body: { phone: '+919000000077' } })
      assert.equal(r.status, 503)
      assert.equal(r.body.devOtp, undefined)
    } finally {
      process.env.NODE_ENV = saved
      await close(server)
    }
  })

  test('too many login codes from one address get a 429', async () => {
    const { base, server } = await startServer()
    try {
      const api = client(base)
      const statuses: number[] = []
      for (let i = 0; i < 7; i++) statuses.push((await api.call('POST', '/api/auth/otp/send', { body: { phone: `+91900001000${i}` } })).status)
      assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200])
      assert.deepEqual(statuses.slice(5), [429, 429])
    } finally {
      await close(server)
    }
  })

  test('five wrong login codes lock the number, even for the right code', async () => {
    const { base, server } = await startServer()
    try {
      const api = client(base)
      const phone = '+919000002000'
      const sent = await api.call('POST', '/api/auth/otp/send', { body: { phone } })
      const wrong = sent.body.devOtp === '000000' ? '111111' : '000000'
      for (let i = 0; i < 5; i++) assert.equal((await api.call('POST', '/api/auth/otp/verify', { body: { phone, otp: wrong } })).status, 401)
      const right = await api.call('POST', '/api/auth/otp/verify', { body: { phone, otp: sent.body.devOtp } })
      assert.equal(right.status, 429)
    } finally {
      await close(server)
    }
  })

  test('guessing the delivery OTP locks the order after five tries', async () => {
    const { base, server } = await startServer()
    try {
      const api = client(base)
      const admin = await api.login(ADMIN, 'admin')
      const id = (await api.call('POST', '/api/orders/create', { token: admin, body: { words: 400 } })).body.order.id
      const step = (nextStatus: string, extra = {}) => api.call('POST', `/api/orders/${id}/transition`, { token: admin, body: { nextStatus, ...extra } })
      await step('Accepted', { scribeId: 'S-TESTBB' })
      await step('Writing')
      await step('Dispatched')
      const realOtp = (await api.call('GET', `/api/orders/${id}`, { token: admin })).body.order.deliveryOtp
      assert.equal((await api.call('POST', '/api/logistics/dispatch', { token: admin, body: { orderId: id } })).status, 200)

      const wrong = realOtp === '000000' ? '111111' : '000000'
      for (let i = 0; i < 5; i++) assert.equal((await api.call('POST', '/api/logistics/confirm-delivery', { token: admin, body: { orderId: id, deliveryOtp: wrong } })).status, 400)
      const locked = await api.call('POST', '/api/logistics/confirm-delivery', { token: admin, body: { orderId: id, deliveryOtp: realOtp } })
      assert.equal(locked.status, 429)
    } finally {
      await close(server)
    }
  })
})
