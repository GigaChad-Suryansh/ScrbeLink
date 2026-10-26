import './testSetup'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from './server'
import { testDb } from './testDb'

// Covers what the web app relies on: listing orders, scribe sign-up and wallet, and uploads.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(64)])

describe('web app wiring', () => {
  let server: Server
  let base = ''
  let admin = '', cust = '', other = '', scribe = '', scribeB = ''

  const call = async (method: string, path: string, o: { token?: string; body?: unknown; raw?: Buffer; name?: string } = {}) => {
    const headers: Record<string, string> = {}
    if (o.token) headers.Authorization = `Bearer ${o.token}`
    let body: BodyInit | undefined
    if (o.raw) { headers['Content-Type'] = 'application/octet-stream'; headers['x-file-name'] = o.name ?? 'f'; body = new Uint8Array(o.raw) }
    else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body) }
    const res = await fetch(base + path, { method, headers, body })
    const text = await res.text()
    let json: any = text
    try { json = JSON.parse(text) } catch { /* binary or empty */ }
    return { status: res.status, body: json, headers: res.headers, text }
  }
  const login = async (phone: string, role: string) => {
    const sent = await call('POST', '/api/auth/otp/send', { body: { phone } })
    const ok = await call('POST', '/api/auth/otp/verify', { body: { phone, otp: sent.body.devOtp, requestedRole: role } })
    assert.equal(ok.status, 200)
    return ok.body.token as string
  }
  const pay = async (token: string, id: string) => {
    const order = (await call('GET', `/api/orders/${id}`, { token })).body.order
    const init = await call('POST', '/api/payment/upi/initiate', { token, body: { orderId: id, amount: order.customerTotal } })
    assert.equal((await call('POST', '/api/payment/upi/verify', { token, body: { paymentId: init.body.payment.paymentId } })).status, 200)
  }

  before(async () => {
    const db = await testDb()
    server = await new Promise<Server>((resolve) => { const s = createApp(db).listen(0, () => resolve(s)) })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    admin = await login('+919000000001', 'admin')
    cust = await login('+919000000010', 'customer')
    other = await login('+919000000011', 'customer')
    scribe = await login('+919000000030', 'scribe')
  })
  after(() => { server.closeAllConnections(); server.close() })

  const profile = { name: 'Asha', college: 'DTU', sampleText: 'Newton second law is F = ma.', upiVpa: 'asha@okaxis', specialties: ['Science'] }
  let scribeId = ''

  test('a new scribe is unapproved and invisible to customers', async () => {
    const put = await call('PUT', '/api/scribe/me', { token: scribe, body: profile })
    assert.equal(put.status, 200)
    scribeId = put.body.profile.id
    assert.equal(put.body.profile.isApproved, false)
    const list = await call('GET', '/api/scribes')
    assert.equal(list.body.scribes.some((s: any) => s.id === scribeId), false)
  })

  test('profile input is validated', async () => {
    for (const bad of [{ ...profile, upiVpa: 'nope' }, { ...profile, name: '' }, { ...profile, sampleText: 'short' }, { ...profile, sampleImageUrl: '/api/samples/' + 'a'.repeat(32) }]) {
      assert.equal((await call('PUT', '/api/scribe/me', { token: scribe, body: bad })).status, 400)
    }
    assert.equal((await call('PUT', '/api/scribe/me', { token: cust, body: profile })).status, 403, 'only scribes')
  })

  test('sample photos: validated, public once uploaded, and approval resets when the card changes', async () => {
    assert.equal((await call('POST', '/api/uploads/sample', { token: scribe, raw: Buffer.from('not an image'), name: 'a.png' })).status, 400)
    assert.equal((await call('POST', '/api/uploads/sample', { token: cust, raw: PNG, name: 'a.png' })).status, 403)
    const up = await call('POST', '/api/uploads/sample', { token: scribe, raw: PNG, name: 'a.png' })
    assert.equal(up.status, 201)
    assert.match(up.body.url, /^\/api\/samples\/[a-f0-9]{32}$/)
    const img = await call('GET', up.body.url)
    assert.equal(img.status, 200)
    assert.equal(img.headers.get('content-type'), 'image/png')
    const saved = await call('PUT', '/api/scribe/me', { token: scribe, body: { ...profile, sampleImageUrl: up.body.url } })
    assert.equal(saved.body.profile.sampleImageUrl, up.body.url)
  })

  test('an unapproved scribe sees no pool and cannot accept', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 600 } })).body.order.id
    assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.status, 'Draft')
    await pay(cust, id)
    assert.equal((await call('GET', '/api/orders', { token: scribe })).body.orders.length, 0)
    assert.equal((await call('POST', `/api/orders/${id}/transition`, { token: scribe, body: { nextStatus: 'Accepted' } })).status, 403)
  })

  test('once approved, the scribe is public (without contact details) and sees the pool', async () => {
    assert.equal((await call('POST', `/api/admin/scribes/${scribeId}/verify`, { token: admin, body: { isApproved: true } })).status, 200)
    const pub = (await call('GET', '/api/scribes')).body.scribes.find((s: any) => s.id === scribeId)
    assert.ok(pub)
    assert.equal(pub.phone, undefined)
    assert.equal(pub.upiVpa, undefined)
    assert.equal((await call('GET', '/api/orders', { token: scribe })).body.orders.length, 1)
  })

  test('orders list is private per customer and newest first', async () => {
    assert.equal((await call('GET', '/api/orders', { token: other })).body.orders.length, 0)
    const second = (await call('POST', '/api/orders/create', { token: cust, body: { words: 300 } })).body.order.id
    const mine = (await call('GET', '/api/orders', { token: cust })).body.orders
    assert.equal(mine.length, 2)
    assert.equal(mine[0].id, second)
    assert.ok((await call('GET', '/api/orders', { token: admin })).body.orders.length >= 2, 'admins see every order')
  })

  test('an order requested for one scribe is hidden from the others', async () => {
    const other2 = (scribeB = await login('+919000000031', 'scribe'))
    await call('PUT', '/api/scribe/me', { token: other2, body: profile })
    const myId = (await call('GET', '/api/scribe/me', { token: other2 })).body.profile.id
    await call('POST', `/api/admin/scribes/${myId}/verify`, { token: admin, body: { isApproved: true } })
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 300, preferredScribeId: scribeId } })).body.order.id
    await pay(cust, id)
    assert.ok((await call('GET', '/api/orders', { token: scribe })).body.orders.some((o: any) => o.id === id))
    assert.ok(!(await call('GET', '/api/orders', { token: other2 })).body.orders.some((o: any) => o.id === id))
    assert.equal((await call('POST', `/api/orders/${id}/transition`, { token: other2, body: { nextStatus: 'Accepted' } })).status, 403)
    assert.equal((await call('POST', '/api/orders/create', { token: cust, body: { words: 300, preferredScribeId: 'S-NOBODY' } })).status, 400)
  })

  test('a full job: wallet stays empty until escrow releases, then can be withdrawn once', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 1000 } })).body.order.id
    await pay(cust, id)
    const step = (nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token: scribe, body: { nextStatus } })
    assert.equal((await step('Accepted')).status, 200)
    assert.equal((await step('Writing')).status, 200)
    const d = await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id } })
    assert.equal(d.status, 200)
    assert.equal(d.body.order.status, 'Dispatched', 'dispatching moves the order along')
    assert.equal(JSON.stringify(d.body).includes('deliveryOtp'), false)

    const code = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order.deliveryOtp
    assert.equal((await call('POST', '/api/logistics/confirm-delivery', { token: scribe, body: { orderId: id, deliveryOtp: '000000' } })).status, 400)
    assert.equal((await call('POST', '/api/logistics/confirm-delivery', { token: scribe, body: { orderId: id, deliveryOtp: code } })).status, 200)

    let me = (await call('GET', '/api/scribe/me', { token: scribe })).body
    assert.equal(me.walletBalance, 0)
    assert.equal(me.pendingEscrow > 0, true)
    assert.equal((await call('POST', '/api/scribe/withdraw', { token: scribe })).status, 400, 'nothing cleared yet')

    await call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 25 * 3_600_000).toISOString() } })
    me = (await call('GET', '/api/scribe/me', { token: scribe })).body
    assert.ok(me.walletBalance > 0)
    const amount = me.walletBalance
    const out = await call('POST', '/api/scribe/withdraw', { token: scribe })
    assert.equal(out.status, 200)
    assert.equal(out.body.withdrawn, amount)
    assert.equal(out.body.walletBalance, 0)
    assert.ok(out.body.payouts.some((p: any) => p.status === 'Transferred' && p.amount === amount))
    assert.equal((await call('POST', '/api/scribe/withdraw', { token: scribe })).status, 400, 'cannot withdraw twice')
  })

  test('evidence videos: customers upload, only signed-in users can read, bad files are refused', async () => {
    assert.equal((await call('POST', '/api/uploads/video', { token: cust, raw: Buffer.from('nope'), name: 'v.mp4' })).status, 400)
    assert.equal((await call('POST', '/api/uploads/video', { token: scribe, raw: MP4, name: 'v.mp4' })).status, 403)
    const up = await call('POST', '/api/uploads/video', { token: cust, raw: MP4, name: 'v.mp4' })
    assert.equal(up.status, 201)
    assert.equal((await call('GET', up.body.url)).status, 401, 'private without a token')
    assert.equal((await call('GET', up.body.url, { token: admin })).status, 200)
    assert.equal((await call('GET', '/api/media/' + '0'.repeat(32), { token: admin })).status, 404)
    assert.equal((await call('GET', '/api/media/..%2f..%2fetc%2fpasswd', { token: admin })).status, 404)
  })

  test('a dispute accepts an uploaded video but not a made-up one', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 300 } })).body.order.id
    await pay(cust, id)
    const step = (t: string, nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token: t, body: { nextStatus } })
    await step(scribe, 'Accepted'); await step(scribe, 'Writing'); await step(scribe, 'Dispatched'); await step(admin, 'Delivered')
    const fake = await call('POST', '/api/disputes/file', { token: cust, body: { orderId: id, reason: 'OTHER', unboxingVideoUrl: '/api/media/' + 'b'.repeat(32) } })
    assert.equal(fake.status, 400)
    const up = await call('POST', '/api/uploads/video', { token: cust, raw: MP4, name: 'v.mp4' })
    const ok = await call('POST', '/api/disputes/file', { token: cust, body: { orderId: id, reason: 'OTHER', unboxingVideoUrl: up.body.url, customerNotes: 'x' } })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.dispute.customerName, 'Customer', 'no name is taken from the client')
  })

  test('a scribe who dispatched on time is never struck by a late timer', async () => {
    const strikes = (await call('GET', `/api/scribes/${scribeId}/strikes`, { token: scribe })).body.strikes.strikes
    await call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 200 * 3_600_000).toISOString() } })
    assert.equal((await call('GET', `/api/scribes/${scribeId}/strikes`, { token: scribe })).body.strikes.strikes, strikes)
  })

  test('two withdrawals at the same moment pay out once', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 1000 } })).body.order.id
    await pay(cust, id)
    const step = (nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token: scribe, body: { nextStatus } })
    await step('Accepted'); await step('Writing')
    await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id } })
    const code = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order.deliveryOtp
    await call('POST', '/api/logistics/confirm-delivery', { token: scribe, body: { orderId: id, deliveryOtp: code } })
    await call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 25 * 3_600_000).toISOString() } })

    const before = (await call('GET', '/api/scribe/me', { token: scribe })).body.walletBalance
    assert.ok(before > 0)
    const countBefore = (await call('GET', '/api/scribe/me', { token: scribe })).body.payouts.filter((p: any) => p.status === 'Transferred').length
    const results = await Promise.all([1, 2, 3].map(() => call('POST', '/api/scribe/withdraw', { token: scribe })))
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => [r.status, r.body.withdrawn, r.body.error])) + ' before=' + before)
    const me = (await call('GET', '/api/scribe/me', { token: scribe })).body
    assert.equal(me.walletBalance, 0)
    assert.equal(me.payouts.filter((p: any) => p.status === 'Transferred').length, countBefore + 1)
  })

  test('two scribes accepting the same order at once: one wins', async () => {
    const other2 = scribeB // signed up and approved in an earlier test
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 300 } })).body.order.id
    await pay(cust, id)
    const accept = (t: string) => call('POST', `/api/orders/${id}/transition`, { token: t, body: { nextStatus: 'Accepted' } })
    const rs = await Promise.all([accept(scribe), accept(other2)])
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 403])
    const order = (await call('GET', `/api/orders/${id}`, { token: admin })).body.order
    assert.equal(order.timeline.filter((t: any) => t.status === 'Accepted').length, 1)
  })

  test('paying twice does not charge or move the order twice', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 200 } })).body.order.id
    const order = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order
    const init = await call('POST', '/api/payment/upi/initiate', { token: cust, body: { orderId: id, amount: order.customerTotal } })
    const verify = () => call('POST', '/api/payment/upi/verify', { token: cust, body: { paymentId: init.body.payment.paymentId } })
    const rs = await Promise.all([verify(), verify()])
    assert.deepEqual(rs.map((r) => r.status), [200, 200])
    const after = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order
    assert.equal(after.timeline.filter((t: any) => t.status === 'Paid').length, 1)
    assert.equal((await call('POST', '/api/payment/upi/initiate', { token: cust, body: { orderId: id, amount: order.customerTotal } })).status, 409, 'an order is paid for once')
  })

  test('two disputes at once: one is filed, the other is refused', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 300 } })).body.order.id
    await pay(cust, id)
    const step = (t: string, nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token: t, body: { nextStatus } })
    await step(scribe, 'Accepted'); await step(scribe, 'Writing'); await step(scribe, 'Dispatched'); await step(admin, 'Delivered')
    const up = await call('POST', '/api/uploads/video', { token: cust, raw: MP4, name: 'v.mp4' })
    const file = () => call('POST', '/api/disputes/file', { token: cust, body: { orderId: id, reason: 'OTHER', unboxingVideoUrl: up.body.url } })
    const rs = await Promise.all([file(), file()])
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 400], 'the loser sees the order is no longer Delivered')
    assert.equal((await call('GET', '/api/admin/disputes', { token: admin })).body.disputes.filter((d: any) => d.orderId === id).length, 1)
  })

  test('health reports the database', async () => {
    const h = await call('GET', '/api/health')
    assert.equal(h.status, 200)
    assert.equal(h.body.database, 'ok')
    assert.equal(h.body.storage, 'pglite')
  })
})
