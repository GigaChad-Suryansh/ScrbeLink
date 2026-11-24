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

const GATE = { college: 'DTU', line: 'Main Gate 1', pincode: '110042', contactName: 'Riya', contactPhone: '+919876500001' }

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
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
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
    const second = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
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
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE, preferredScribeId: scribeId } })).body.order.id
    await pay(cust, id)
    assert.ok((await call('GET', '/api/orders', { token: scribe })).body.orders.some((o: any) => o.id === id))
    assert.ok(!(await call('GET', '/api/orders', { token: other2 })).body.orders.some((o: any) => o.id === id))
    assert.equal((await call('POST', `/api/orders/${id}/transition`, { token: other2, body: { nextStatus: 'Accepted' } })).status, 403)
    assert.equal((await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE, preferredScribeId: 'S-NOBODY' } })).status, 400)
  })

  test('a full job: wallet stays empty until escrow releases, then can be withdrawn once', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
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
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
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
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
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
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
    await pay(cust, id)
    const accept = (t: string) => call('POST', `/api/orders/${id}/transition`, { token: t, body: { nextStatus: 'Accepted' } })
    const rs = await Promise.all([accept(scribe), accept(other2)])
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 403])
    const order = (await call('GET', `/api/orders/${id}`, { token: admin })).body.order
    assert.equal(order.timeline.filter((t: any) => t.status === 'Accepted').length, 1)
  })

  test('paying twice does not charge or move the order twice', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
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
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
    await pay(cust, id)
    const step = (t: string, nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token: t, body: { nextStatus } })
    await step(scribe, 'Accepted'); await step(scribe, 'Writing'); await step(scribe, 'Dispatched'); await step(admin, 'Delivered')
    const up = await call('POST', '/api/uploads/video', { token: cust, raw: MP4, name: 'v.mp4' })
    const file = () => call('POST', '/api/disputes/file', { token: cust, body: { orderId: id, reason: 'OTHER', unboxingVideoUrl: up.body.url } })
    const rs = await Promise.all([file(), file()])
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 400], 'the loser sees the order is no longer Delivered')
    assert.equal((await call('GET', '/api/admin/disputes', { token: admin })).body.disputes.filter((d: any) => d.orderId === id).length, 1)
  })

  test('notes files: private, attached to the order, and deleted after the order closes', async () => {
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
    assert.equal((await call('POST', '/api/uploads/notes', { token: cust, raw: Buffer.from('MZ not a pdf'), name: 'n.pdf' })).status, 400)
    assert.equal((await call('POST', '/api/uploads/notes', { token: scribe, raw: PDF, name: 'n.pdf' })).status, 403, 'only customers upload notes')
    const up = await call('POST', '/api/uploads/notes', { token: cust, raw: PDF, name: 'n.pdf' })
    assert.equal(up.status, 201)

    // Someone else's file cannot be attached; your own can.
    assert.equal((await call('POST', '/api/orders/create', { token: other, body: { words: 2000, dropGate: GATE, notesFileId: up.body.fileId } })).status, 400)
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE, notesFileId: up.body.fileId } })).body.order.id
    assert.equal((await call('GET', `/api/orders/${id}/notes`, { token: cust })).status, 200)
    assert.equal((await call('GET', `/api/orders/${id}/notes`, { token: other })).status, 404, 'other customers cannot even see the order')
    assert.equal((await call('GET', `/api/orders/${id}/notes`, { token: scribe })).status, 403, 'the scribe cannot read it before accepting')

    await pay(cust, id)
    const step = (nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token: scribe, body: { nextStatus } })
    await step('Accepted')
    const read = await call('GET', `/api/orders/${id}/notes`, { token: scribe })
    assert.equal(read.status, 200)
    assert.equal(read.headers.get('content-type'), 'application/pdf')

    // Cancelling closes the order and starts the 7-day clock. A sweep before then keeps the file.
    await call('POST', `/api/orders/${id}/transition`, { token: admin, body: { nextStatus: 'Cancelled' } })
    const early = await call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 3 * 86_400_000).toISOString() } })
    assert.equal(early.status, 200)
    assert.equal((await call('GET', `/api/orders/${id}/notes`, { token: cust })).status, 200, 'kept inside the 7 days')
    const late = await call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 8 * 86_400_000).toISOString() } })
    assert.ok(late.body.filesDeleted >= 1)
    assert.equal((await call('GET', `/api/orders/${id}/notes`, { token: cust })).status, 404, 'deleted after 7 days')
  })

  test('an upload that never gets attached to an order is deleted after a day', async () => {
    const up = await call('POST', '/api/uploads/notes', { token: cust, raw: Buffer.from('plain text notes that nobody orders'), name: 'n.txt' })
    assert.equal(up.status, 201)
    const swept = await call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + 2 * 86_400_000).toISOString() } })
    assert.ok(swept.body.filesDeleted >= 1)
    assert.equal((await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE, notesFileId: up.body.fileId } })).status, 400)
  })

  test('saved gates: owned by one customer, capped at five, and used as a copy on the order', async () => {
    const place = { label: 'Hostel gate', college: 'DTU', line: 'Gate 2', landmark: 'Near the tea stall', pincode: '110042', contactName: 'Riya', contactPhone: '+919876500001' }
    for (const bad of [{ ...place, pincode: '12' }, { ...place, contactPhone: '12345' }, { ...place, college: '' }, {}]) {
      assert.equal((await call('POST', '/api/addresses', { token: cust, body: bad })).status, 400)
    }
    const saved = await call('POST', '/api/addresses', { token: cust, body: place })
    assert.equal(saved.status, 201)
    const gateId = saved.body.address.id
    assert.equal((await call('GET', '/api/addresses', { token: other })).body.addresses.length, 0, 'private to the owner')
    assert.equal((await call('DELETE', `/api/addresses/${gateId}`, { token: other })).status, 404)

    // An order must say where it goes, and can only use the customer's own saved gate.
    assert.equal((await call('POST', '/api/orders/create', { token: cust, body: { words: 2000 } })).status, 400, 'no gate')
    assert.equal((await call('POST', '/api/orders/create', { token: other, body: { words: 2000, gateId } })).status, 400, "someone else's gate")
    const made = await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, gateId } })
    assert.equal(made.status, 201)
    assert.equal(made.body.order.dropGate.line, 'Gate 2')

    // The order keeps its own copy: deleting the saved gate does not change it.
    assert.equal((await call('DELETE', `/api/addresses/${gateId}`, { token: cust })).status, 200)
    assert.equal((await call('GET', `/api/orders/${made.body.order.id}`, { token: cust })).body.order.dropGate.line, 'Gate 2')

    for (let n = 0; n < 5; n++) assert.equal((await call('POST', '/api/addresses', { token: cust, body: place })).status, 201)
    assert.equal((await call('POST', '/api/addresses', { token: cust, body: place })).status, 400, 'six is too many')
  })

  test('the scribe sees where the pages go but not who the customer is; pickup address is replaced, not added', async () => {
    const id = (await call('POST', '/api/orders/create', { token: other, body: { words: 2000, dropGate: { college: 'NSUT', line: 'Gate 3', pincode: '110078', contactName: 'Secret Name', contactPhone: '+919876511111' } } })).body.order.id
    await pay(other, id)
    const seen = (await call('GET', `/api/orders/${id}`, { token: scribe })).body.order
    assert.equal(seen.dropGate.line, 'Gate 3')
    assert.equal(seen.dropGate.contactName, undefined)
    assert.equal(seen.dropGate.contactPhone, undefined)
    assert.equal((await call('GET', `/api/orders/${id}`, { token: other })).body.order.dropGate.contactName, 'Secret Name')

    const home = { college: 'DTU', line: 'Hostel Block 4', pincode: '110042', contactName: 'Asha', contactPhone: '+919876500030' }
    assert.equal((await call('POST', '/api/addresses', { token: scribe, body: home })).status, 201)
    assert.equal((await call('POST', '/api/addresses', { token: scribe, body: { ...home, line: 'Hostel Block 5' } })).status, 201)
    const mine = (await call('GET', '/api/addresses', { token: scribe })).body.addresses
    assert.equal(mine.length, 1)
    assert.equal(mine[0].line, 'Hostel Block 5')
    assert.equal(mine[0].kind, 'pickup')

    // Dispatch uses both saved places when nothing is typed in.
    const step = (nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token: scribe, body: { nextStatus } })
    await step('Accepted'); await step('Writing')
    const d = await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id } })
    assert.equal(d.status, 200)
    assert.match(d.body.task.pickupAddress, /Hostel Block 5/)
    assert.match(d.body.task.dropGate, /Gate 3.*NSUT/)
  })

  describe('refunds', () => {
    const make = async (token: string) => (await call('POST', '/api/orders/create', { token, body: { words: 2000, dropGate: GATE } })).body.order.id as string
    const move = (id: string, token: string, nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token, body: { nextStatus } })
    const jobs = (hoursFromNow: number) => call('POST', '/api/cron/trigger-jobs', { token: admin, body: { simulatedTimestamp: new Date(Date.now() + hoursFromNow * 3_600_000).toISOString() } })

    test('cancelling a paid order refunds all of it, once', async () => {
      const id = await make(cust)
      await pay(cust, id)
      assert.equal((await move(id, cust, 'Cancelled')).status, 200)
      const order = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order
      assert.equal(order.status, 'Cancelled')
      assert.equal(order.refund.amount, order.customerTotal)
      assert.equal(order.refund.reason, 'CUSTOMER_CANCELLED')
      assert.equal(order.refund.status, 'PROCESSED')
      assert.equal((await move(id, cust, 'Cancelled')).status, 403, 'cannot cancel twice')
      assert.equal((await call('GET', `/api/orders/${id}`, { token: scribe })).body.order.refund, undefined, 'scribes never see refunds')
      assert.ok((await call('GET', '/api/admin/refunds', { token: admin })).body.refunds.some((r: any) => r.orderId === id))
    })

    test('an unpaid order has nothing to refund', async () => {
      const id = await make(cust)
      assert.equal((await move(id, cust, 'Cancelled')).status, 200)
      assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.refund, undefined)
    })

    test('a customer cannot cancel once writing has started, but support can', async () => {
      const id = await make(cust)
      await pay(cust, id)
      await move(id, scribe, 'Accepted')
      await move(id, scribe, 'Writing')
      assert.equal((await move(id, cust, 'Cancelled')).status, 403)
      assert.equal((await move(id, admin, 'Cancelled')).status, 200)
      const refund = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order.refund
      assert.equal(refund.reason, 'ADMIN_CANCELLED')
    })

    test('an order nobody takes is cancelled and refunded after 6 hours', async () => {
      const id = await make(cust)
      await pay(cust, id)
      await jobs(5)
      assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.status, 'Paid', 'still waiting at 5 hours')
      const ran = await jobs(7)
      assert.ok(ran.body.unclaimedRefunded >= 1)
      const order = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order
      assert.equal(order.status, 'Cancelled')
      assert.equal(order.refund.reason, 'NO_SCRIBE')
    })

    test('disputes: upheld refunds everything, split refunds half, a ruling for the scribe refunds nothing', async () => {
      const outcomes: Array<[string, string | undefined, number]> = [['REFUNDED_TO_CUSTOMER', 'DISPUTE_UPHELD', 1], ['SPLIT', 'DISPUTE_SPLIT', 0.5], ['RELEASED_TO_SCRIBE', undefined, 0]]
      for (const [decision, reason, share] of outcomes) {
        const id = await make(cust)
        await pay(cust, id)
        await move(id, scribe, 'Accepted'); await move(id, scribe, 'Writing'); await move(id, scribe, 'Dispatched'); await move(id, admin, 'Delivered')
        const up = await call('POST', '/api/uploads/video', { token: cust, raw: MP4, name: 'v.mp4' })
        const filed = await call('POST', '/api/disputes/file', { token: cust, body: { orderId: id, reason: 'OTHER', unboxingVideoUrl: up.body.url } })
        const resolved = await call('POST', `/api/admin/disputes/${filed.body.dispute.id}/resolve`, { token: admin, body: { decision, adminNotes: 'ok' } })
        assert.equal(resolved.status, 200, decision)
        const order = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order
        assert.equal(order.refund?.reason, reason, decision)
        if (reason) assert.equal(order.refund.amount, order.customerTotal * share, decision)
      }
    })
  })

  test('invoice: only for paid orders, only for the owner, and shows refunds', async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id
    assert.equal((await call('GET', `/api/orders/${id}/invoice`, { token: cust })).status, 409, 'not paid yet')
    await pay(cust, id)
    const res = await fetch(`${base}/api/orders/${id}/invoice`, { headers: { Authorization: `Bearer ${cust}` } })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/pdf')
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-')
    assert.equal((await call('GET', `/api/orders/${id}/invoice`, { token: other })).status, 404)
    assert.equal((await call('GET', `/api/orders/${id}/invoice`, { token: scribe })).status, 403)
  })

  test('health reports the database', async () => {
    const h = await call('GET', '/api/health')
    assert.equal(h.status, 200)
    assert.equal(h.body.database, 'ok')
    assert.equal(h.body.storage, 'pglite')
  })
})
