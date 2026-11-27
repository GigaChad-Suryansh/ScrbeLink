/**
 * phase17AdminOps.test.ts
 * Phase 17: Admin dashboard stats, order search, manual reassign/refund,
 * scribe suspend/reinstate, resend notification, audit log, and accounts CSV export.
 */

import './testSetup'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { createApp } from './server'
import { testDb } from './testDb'
import { csvCell } from './adminOps'

const GATE = { college: 'DTU', line: 'Main Gate 1', pincode: '110042', contactName: 'Riya', contactPhone: '+919876500001' }

describe('csvCell', () => {
  test('escapes commas, quotes, and newlines per RFC 4180', () => {
    assert.equal(csvCell('plain'), 'plain')
    assert.equal(csvCell('a,b'), '"a,b"')
    assert.equal(csvCell('say "hi"'), '"say ""hi"""')
    assert.equal(csvCell(null), '')
  })
})

describe('Phase 17 admin operations end to end', () => {
  let server: Server
  let base = ''
  let db: Awaited<ReturnType<typeof testDb>>

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const ct = res.headers.get('content-type') ?? ''
    const data = ct.includes('application/json') ? await res.json() : await res.text()
    return { status: res.status, data }
  }

  const login = async (phone: string, requestedRole: 'customer' | 'scribe' | 'admin') => {
    const send = await call('POST', '/api/auth/otp/send', undefined, { phone })
    const verify = await call('POST', '/api/auth/otp/verify', undefined, { phone, otp: send.data.devOtp, requestedRole })
    return verify.data.token as string
  }

  before(async () => {
    db = await testDb()
    server = createApp(db).listen(0)
    const addr = server.address() as { port: number }
    base = `http://127.0.0.1:${addr.port}`
  })

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await db.close()
  })

  test('admin can view stats, search orders, resolve stuck order, suspend/reinstate scribe, resend message, and export CSV', async () => {
    const custToken = await login('+919811111111', 'customer')
    const scribeToken = await login('+919822222222', 'scribe')
    const adminToken = await login('+919000000001', 'admin')

    // Onboard and approve scribe
    const prof = await call('PUT', '/api/scribe/me', scribeToken, {
      name: 'Ops Scribe',
      college: 'DTU',
      sampleText: 'Clean sample handwriting for testing.',
      upiVpa: 'ops@okaxis',
      specialties: ['Engineering & Tech'],
    })
    assert.equal(prof.status, 200)
    const scribeId = prof.data.profile.id as string
    await call('POST', `/api/admin/scribes/${scribeId}/verify`, adminToken, { isApproved: true })

    // Create and pay an order
    const gate = await call('POST', '/api/addresses', custToken, GATE)
    const created = await call('POST', '/api/orders/create', custToken, {
      title: 'Thermodynamics Notes',
      subject: 'Physics & Chemistry',
      words: 2200,
      penStyle: 'Blue Ballpoint',
      gateId: gate.data.address.id,
    })
    assert.equal(created.status, 201)
    const orderId = created.data.order.id as string
    const amount = created.data.order.customerTotal as number

    const initPay = await call('POST', '/api/payment/upi/initiate', custToken, { orderId, amount, payerVpa: 'cust@upi' })
    assert.equal(initPay.status, 200)
    const verPay = await call('POST', '/api/payment/upi/verify', custToken, { paymentId: initPay.data.payment.paymentId })
    assert.equal(verPay.status, 200)

    // Scribe accepts order (now stuck in Accepted)
    const acc = await call('POST', `/api/orders/${orderId}/transition`, scribeToken, { nextStatus: 'Accepted' })
    assert.equal(acc.status, 200)

    // 1. Dashboard stats
    const stats = await call('GET', '/api/admin/stats', adminToken)
    assert.equal(stats.status, 200)
    assert.equal(stats.data.stats.ordersToday, 1)
    assert.equal(stats.data.stats.openDisputes, 0)

    // 2. Search by order ID and by customer phone
    const byId = await call('GET', `/api/admin/orders?q=${encodeURIComponent(orderId)}`, adminToken)
    assert.equal(byId.status, 200)
    assert.equal(byId.data.orders.length, 1)
    assert.equal(byId.data.orders[0].scribeId, scribeId)

    const byPhone = await call('GET', `/api/admin/orders?q=${encodeURIComponent('9811111111')}`, adminToken)
    assert.equal(byPhone.data.orders.length, 1)

    // 3. Reassign stuck order
    const reass = await call('POST', `/api/admin/orders/${orderId}/reassign`, adminToken, { reason: 'Scribe stalled' })
    assert.equal(reass.status, 200)
    assert.equal(reass.data.order.status, 'Reassigned')
    assert.equal(reass.data.order.scribeId, undefined)

    // 4. Suspend and reinstate scribe
    const susp = await call('POST', `/api/admin/scribes/${scribeId}/suspend`, adminToken, { suspended: true })
    assert.equal(susp.status, 200)
    assert.equal(susp.data.scribe.isSuspended, true)

    const rein = await call('POST', `/api/admin/scribes/${scribeId}/suspend`, adminToken, { suspended: false })
    assert.equal(rein.status, 200)
    assert.equal(rein.data.scribe.isSuspended, false)

    // 5. Resend a message
    const resend = await call('POST', '/api/admin/notifications/resend', adminToken, {
      phone: '+919811111111',
      event: 'ORDER_REASSIGNED',
      message: 'Your order is being assigned to a new scribe.',
    })
    assert.equal(resend.status, 200)

    // 6. Manual refund & cancel
    const ref = await call('POST', `/api/admin/orders/${orderId}/refund`, adminToken, { reason: 'Customer requested' })
    assert.equal(ref.status, 200)

    // 7. Audit log has entries
    const audit = await call('GET', '/api/admin/audit-log', adminToken)
    assert.equal(audit.status, 200)
    assert.ok(audit.data.entries.length >= 4)

    // 8. Accounts CSV export
    const csv = await call('GET', '/api/admin/export/accounts.csv', adminToken)
    assert.equal(csv.status, 200)
    assert.ok(String(csv.data).includes('order_id,created_at,status'))
    assert.ok(String(csv.data).includes(orderId))
  })
})

