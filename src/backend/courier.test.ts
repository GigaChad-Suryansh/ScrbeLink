import './testSetup'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { createApp } from './server'
import { testDb } from './testDb'

const GATE = { college: 'DTU', line: 'Main Gate 1', pincode: '110042', contactName: 'Riya', contactPhone: '+919876500001' }
const HOME = { college: 'DTU', line: 'Hostel Block 4', pincode: '110042', contactName: 'Asha', contactPhone: '+919876500030' }

describe('courier: manual rider flow', () => {
  let server: Server
  let base = ''
  let cust = '', scribe = '', admin = ''

  const call = async (method: string, path: string, o: { token?: string; body?: unknown } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }
  const login = async (phone: string, role: string) => {
    const sent = await call('POST', '/api/auth/otp/send', { body: { phone } })
    return (await call('POST', '/api/auth/otp/verify', { body: { phone, otp: sent.body.devOtp, requestedRole: role } })).body.token as string
  }

  before(async () => {
    process.env.COURIER_PROVIDER = 'manual'
    const db = await testDb()
    server = await new Promise<Server>((resolve) => { const s = createApp(db).listen(0, () => resolve(s)) })
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    cust = await login('+919876543201', 'customer')
    scribe = await login('+919876543202', 'scribe')
    admin = await login('+919000000001', 'admin')
    const put = await call('PUT', '/api/scribe/me', { token: scribe, body: { name: 'Asha', college: 'DTU', sampleText: 'Newton second law is F = ma.', upiVpa: 'asha@okaxis', specialties: ['Science'] } })
    await call('POST', `/api/admin/scribes/${put.body.profile.id}/verify`, { token: admin, body: { isApproved: true } })
    await call('POST', '/api/addresses', { token: scribe, body: HOME })
  })
  after(() => { delete process.env.COURIER_PROVIDER; server.closeAllConnections(); server.close() })

  const pay = async (id: string) => {
    const order = (await call('GET', `/api/orders/${id}`, { token: cust })).body.order
    const init = await call('POST', '/api/payment/upi/initiate', { token: cust, body: { orderId: id, amount: order.customerTotal } })
    await call('POST', '/api/payment/upi/verify', { token: cust, body: { paymentId: init.body.payment.paymentId } })
  }
  const move = (id: string, token: string, nextStatus: string) => call('POST', `/api/orders/${id}/transition`, { token, body: { nextStatus } })
  const toWriting = async () => {
    const id = (await call('POST', '/api/orders/create', { token: cust, body: { words: 2000, dropGate: GATE } })).body.order.id as string
    await pay(id)
    await move(id, scribe, 'Accepted')
    await move(id, scribe, 'Writing')
    return id
  }
  const customerOtp = async (id: string) => (await call('GET', `/api/orders/${id}`, { token: cust })).body.order.deliveryOtp as string

  test('the whole journey: pickup request, rider, pickup code, delivery code', async () => {
    const id = await toWriting()

    // The scribe must have packed the pages, and needs a pickup address.
    assert.equal((await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id } })).status, 400, 'packing not confirmed')
    const asked = await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id, packed: true } })
    assert.equal(asked.status, 200)
    assert.equal(asked.body.task.status, 'BOOKING_REQUESTED')
    assert.match(asked.body.task.pickupOtp, /^\d{6}$/)
    assert.equal(asked.body.task.deliveryOtp, undefined, 'the scribe never sees the delivery code')
    assert.equal(asked.body.task.riderToken, undefined)
    assert.equal(asked.body.order.status, 'Writing', 'not dispatched until a rider has the parcel')
    const again = await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id, packed: true } })
    assert.equal(again.body.task.pickupOtp, asked.body.task.pickupOtp, 'asking twice does not change the code')

    // The admin queue shows it with both contacts.
    const queue = (await call('GET', '/api/admin/courier', { token: admin })).body.tasks.find((t: any) => t.orderId === id)
    assert.equal(queue.status, 'BOOKING_REQUESTED')
    assert.equal(queue.pickupContact.name, 'Asha')
    assert.equal(queue.dropContact.name, 'Riya')
    assert.equal((await call('GET', '/api/admin/courier', { token: cust })).status, 403)

    // Assigning a rider makes a private link.
    assert.equal((await call('POST', `/api/admin/courier/${id}/assign`, { token: admin, body: { riderName: 'Suraj', riderPhone: 'abc' } })).status, 400)
    const assigned = await call('POST', `/api/admin/courier/${id}/assign`, { token: admin, body: { riderName: 'Suraj', riderPhone: '+919811122334', trackingUrl: 'https://porter.example/t/1' } })
    assert.equal(assigned.status, 200)
    const token = assigned.body.riderLink.split('/rider/')[1]
    assert.ok(token.length >= 20)
    assert.match(assigned.body.whatsapp, /^https:\/\/wa\.me\/919811122334/)
    assert.equal((await call('POST', `/api/admin/courier/${id}/assign`, { token: admin, body: { riderName: 'X', riderPhone: '+919811122335' } })).status, 409, 'already assigned')

    // The customer sees who is coming, but not the secret link or the scribe's pickup code.
    const seen = (await call('GET', `/api/orders/${id}/courier`, { token: cust })).body.courier
    assert.equal(seen.riderName, 'Suraj')
    assert.equal(seen.pickupOtp, undefined)
    assert.equal(seen.riderToken, undefined)

    // The rider's page shows both ends. A bad link shows nothing.
    const page = await call('GET', `/api/rider/${token}`)
    assert.equal(page.status, 200)
    assert.equal(page.body.task.pickupContact.phone, '+919876500030')
    assert.equal(page.body.task.deliveryOtp, undefined)
    assert.equal(page.body.task.pickupOtp, undefined)
    assert.equal((await call('GET', '/api/rider/not-a-real-token')).status, 404)

    // Delivering before collecting is refused. A wrong pickup code is refused.
    assert.equal((await call('POST', `/api/rider/${token}/deliver`, { body: { deliveryOtp: await customerOtp(id) } })).status, 409)
    assert.equal((await call('POST', `/api/rider/${token}/pickup`, { body: { pickupOtp: '000000' } })).status, 400)
    const picked = await call('POST', `/api/rider/${token}/pickup`, { body: { pickupOtp: asked.body.task.pickupOtp } })
    assert.equal(picked.status, 200)
    assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.status, 'Dispatched')

    // A wrong delivery code is refused. The right one completes the order.
    assert.equal((await call('POST', `/api/rider/${token}/deliver`, { body: { deliveryOtp: '000000' } })).status, 400)
    assert.equal((await call('POST', `/api/rider/${token}/deliver`, { body: { deliveryOtp: await customerOtp(id) } })).status, 200)
    assert.equal((await call('GET', `/api/orders/${id}`, { token: cust })).body.order.status, 'Delivered')
    assert.equal((await call('GET', '/api/admin/courier', { token: admin })).body.tasks.some((t: any) => t.orderId === id), false, 'finished tasks leave the queue')
  })

  test('customers and scribes cannot confirm delivery themselves in manual mode', async () => {
    const id = await toWriting()
    await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id, packed: true } })
    for (const token of [cust, scribe]) {
      assert.equal((await call('POST', '/api/logistics/confirm-delivery', { token, body: { orderId: id, deliveryOtp: await customerOtp(id) } })).status, 403)
    }
  })

  test('five wrong pickup codes lock the rider out', async () => {
    const id = await toWriting()
    await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id, packed: true } })
    const token = (await call('POST', `/api/admin/courier/${id}/assign`, { token: admin, body: { riderName: 'Suraj', riderPhone: '+919811122334' } })).body.riderLink.split('/rider/')[1]
    for (let n = 0; n < 5; n++) assert.equal((await call('POST', `/api/rider/${token}/pickup`, { body: { pickupOtp: '111111' } })).status, 400)
    assert.equal((await call('POST', `/api/rider/${token}/pickup`, { body: { pickupOtp: '111111' } })).status, 429)
  })

  test('a failed rider is replaced: the old link dies and, after three failures, an admin is warned', async () => {
    const id = await toWriting()
    await call('POST', '/api/logistics/dispatch', { token: scribe, body: { orderId: id, packed: true } })
    const first = (await call('POST', `/api/admin/courier/${id}/assign`, { token: admin, body: { riderName: 'Suraj', riderPhone: '+919811122334' } })).body.riderLink.split('/rider/')[1]
    assert.equal((await call('POST', `/api/admin/courier/${id}/rebook`, { token: admin, body: { reason: 'Rider cancelled' } })).body.needsAttention, false)
    assert.equal((await call('GET', `/api/rider/${first}`)).status, 404, 'the old link no longer works')
    await call('POST', `/api/admin/courier/${id}/assign`, { token: admin, body: { riderName: 'Mohan', riderPhone: '+919811122336' } })
    assert.equal((await call('POST', `/api/admin/courier/${id}/rebook`, { token: admin, body: { reason: 'No answer' } })).body.attempts, 3)
    await call('POST', `/api/admin/courier/${id}/assign`, { token: admin, body: { riderName: 'Vijay', riderPhone: '+919811122337' } })
    const fourth = await call('POST', `/api/admin/courier/${id}/rebook`, { token: admin, body: { reason: 'Vehicle broke down' } })
    assert.equal(fourth.body.needsAttention, true)
    const row = (await call('GET', '/api/admin/courier', { token: admin })).body.tasks.find((t: any) => t.orderId === id)
    assert.equal(row.needsAttention, true)
    assert.ok(row.history.length >= 4)
  })
})
