/**
 * phase18Legal.test.ts
 * Phase 18: Legal acceptance tracking, DPDP data export/erasure,
 * confidential exam blocklist, and misuse reporting.
 */

import './testSetup'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { createApp } from './server'
import { testDb } from './testDb'
import { checkConfidentialBlocklist } from '../shared/rules'
import { POLICY_VERSION } from '../shared/legal'

const GATE = { college: 'DTU', line: 'Main Gate 1', pincode: '110042', contactName: 'Riya', contactPhone: '+919876500001' }

describe('checkConfidentialBlocklist', () => {
  test('flags confidential exam keywords', () => {
    assert.equal(checkConfidentialBlocklist('Strictly Confidential Question Paper').blocked, true)
    assert.equal(checkConfidentialBlocklist('End Semester Examination Answer Key').blocked, true)
    assert.equal(checkConfidentialBlocklist('Thermodynamics Lecture Notes').blocked, false)
  })
})

describe('Phase 18 legal, DPDP, blocklist, and misuse reports', () => {
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
    return { status: res.status, data: (await res.json()) as any }
  }

  const login = async (phone: string, requestedRole: 'customer' | 'admin', withConsent = false) => {
    const send = await call('POST', '/api/auth/otp/send', undefined, { phone })
    const verify = await call('POST', '/api/auth/otp/verify', undefined, {
      phone,
      otp: send.data.devOtp,
      requestedRole,
      ...(withConsent ? { acceptedPolicyVersion: POLICY_VERSION, storageConsent: true } : {}),
    })
    return verify
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

  test('records policy acceptance, enforces confidential blocklist, supports DPDP export/delete and misuse reports', async () => {
    const custLogin = await login('+919833333333', 'customer', true)
    assert.equal(custLogin.status, 200)
    assert.equal(custLogin.data.acceptedPolicyVersion, POLICY_VERSION)
    const custToken = custLogin.data.token as string

    const adminLogin = await login('+919000000001', 'admin', false)
    const adminToken = adminLogin.data.token as string

    // 1. Legal acceptance persisted
    const legalRec = await call('GET', '/api/account/legal', custToken)
    assert.equal(legalRec.status, 200)
    assert.equal(legalRec.data.acceptance.policyVersion, POLICY_VERSION)
    assert.equal(legalRec.data.acceptance.storageConsent, true)

    // 2. Confidential exam material blocked on order creation
    const gate = await call('POST', '/api/addresses', custToken, GATE)
    const blocked = await call('POST', '/api/orders/create', custToken, {
      title: 'Strictly Confidential Question Paper 2026',
      subject: 'Physics',
      words: 2200,
      gateId: gate.data.address.id,
    })
    assert.equal(blocked.status, 400)

    // Allowed order succeeds
    const allowed = await call('POST', '/api/orders/create', custToken, {
      title: 'Organic Chemistry Summary',
      subject: 'Physics & Chemistry',
      words: 2200,
      gateId: gate.data.address.id,
    })
    assert.equal(allowed.status, 201)
    const orderId = allowed.data.order.id as string

    // 3. Misuse report
    const rpt = await call('POST', '/api/reports', custToken, {
      targetType: 'order',
      targetId: orderId,
      reason: 'Suspected exam material',
      details: 'Cover sheet mentions university exam',
    })
    assert.equal(rpt.status, 201)

    const adminRpts = await call('GET', '/api/admin/reports', adminToken)
    assert.equal(adminRpts.status, 200)
    assert.ok(adminRpts.data.reports.some((r: { id: string }) => r.id === rpt.data.report.id))

    // 4. DPDP data export
    const exp = await call('GET', '/api/account/data-export', custToken)
    assert.equal(exp.status, 200)
    assert.equal(exp.data.data.orders.length, 1)
    assert.equal(exp.data.data.addresses.length, 1)

    // 5. DPDP data deletion
    const del = await call('DELETE', '/api/account/data', custToken)
    assert.equal(del.status, 200)
    assert.equal(del.data.anonymizedOrders, 1)
    assert.equal(del.data.deletedAddresses, 1)

    const expAfter = await call('GET', '/api/account/data-export', custToken)
    assert.equal(expAfter.data.data.orders.length, 0)
    assert.equal(expAfter.data.data.addresses.length, 0)
  })
})
