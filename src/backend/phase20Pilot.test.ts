/**
 * phase20Pilot.test.ts
 * Phase 20: pilot metrics, referral credits (₹50 each side, from ScribeLink's share),
 * scribe ratings on the picker, and demo scribes hidden in production.
 */

import './testSetup'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { createApp } from './server'
import { testDb } from './testDb'
import { computePilotMetrics, median, weekStart } from './pilot'
import { normaliseCode } from './referrals'
import { seedDemoData } from './logisticsService'

const GATE = { college: 'JSSATE', line: 'Gate 2', pincode: '201301', contactName: 'Riya', contactPhone: '+919876500001' }

describe('pilot metric maths', () => {
  test('median and Monday week start', () => {
    assert.equal(median([]), null)
    assert.equal(median([5, 1, 3]), 3)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.equal(weekStart(Date.parse('2026-11-29T10:00:00Z')), '2026-11-23') // Sunday -> Monday before
    assert.equal(weekStart(Date.parse('2026-11-23T00:00:00Z')), '2026-11-23')
  })

  test('groups by paid week and computes accept, deliver, disputes and rating', () => {
    const t = (paid: string, rest: Array<[string, string]>) => [{ status: 'Draft', timestamp: paid }, { status: 'Paid', timestamp: paid }, ...rest.map(([status, timestamp]) => ({ status, timestamp }))]
    const weeks = computePilotMetrics([
      { timeline: t('2026-11-24T10:00:00Z', [['Accepted', '2026-11-24T10:30:00Z'], ['Delivered', '2026-11-25T10:00:00Z']]), stars: 5 },
      { timeline: t('2026-11-25T10:00:00Z', [['Accepted', '2026-11-25T10:10:00Z'], ['Delivered', '2026-11-26T22:00:00Z'], ['Disputed', '2026-11-27T10:00:00Z']]), stars: 2 },
      { timeline: t('2026-11-26T10:00:00Z', []) },
      { timeline: t('2026-11-17T10:00:00Z', [['Accepted', '2026-11-17T11:00:00Z']]) },
      { timeline: [{ status: 'Draft', timestamp: '2026-11-26T10:00:00Z' }] }, // never paid: ignored
    ])
    assert.equal(weeks.length, 2)
    const [now, prev] = weeks
    assert.equal(now.week, '2026-11-23')
    assert.equal(now.paidOrders, 3)
    assert.equal(now.medianMinutesToAccept, 20)
    assert.equal(now.medianHoursToDeliver, 30)
    assert.equal(now.delivered, 2)
    assert.equal(now.disputed, 1)
    assert.equal(now.disputeRatePercent, 33.3)
    assert.equal(now.averageRating, 3.5)
    assert.equal(prev.week, '2026-11-16')
    assert.equal(prev.medianMinutesToAccept, 60)
    assert.equal(prev.medianHoursToDeliver, null)
    assert.equal(prev.averageRating, null)
  })

  test('referral codes are normalised', () => {
    assert.equal(normaliseCode(' sl-ab cd23 '), 'SLABCD23')
  })
})

describe('Phase 20 end to end', () => {
  let server: Server
  let base = ''
  let db: Awaited<ReturnType<typeof testDb>>

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, data: await res.json() }
  }
  const login = async (phone: string, requestedRole: 'customer' | 'scribe' | 'admin') => {
    const send = await call('POST', '/api/auth/otp/send', undefined, { phone })
    const verify = await call('POST', '/api/auth/otp/verify', undefined, { phone, otp: send.data.devOtp, requestedRole })
    return verify.data.token as string
  }
  const newOrder = async (token: string) => {
    const gate = await call('POST', '/api/addresses', token, GATE)
    const created = await call('POST', '/api/orders/create', token, { title: 'Thermo', subject: 'Physics', words: 2200, gateId: gate.data.address.id })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    return created.data.order
  }
  const pay = async (token: string, order: { id: string; customerTotal: number }) => {
    const init = await call('POST', '/api/payment/upi/initiate', token, { orderId: order.id, amount: order.customerTotal, payerVpa: 'cust@upi' })
    assert.equal(init.status, 200, JSON.stringify(init.data))
    const ver = await call('POST', '/api/payment/upi/verify', token, { paymentId: init.data.payment.paymentId })
    assert.equal(ver.status, 200)
  }

  before(async () => {
    db = await testDb()
    server = createApp(db).listen(0)
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  test('referral: ₹50 off the friend, ₹50 credit to the referrer on delivery, scribe pay unchanged', async () => {
    const alice = await login('+919811110001', 'customer')
    const bob = await login('+919811110002', 'customer')
    const scribe = await login('+919822220001', 'scribe')
    const admin = await login('+919000000001', 'admin')

    const prof = await call('PUT', '/api/scribe/me', scribe, { name: 'Pilot Scribe', college: 'JSSATE', sampleText: 'Neat sample.', upiVpa: 'pilot@okaxis', specialties: ['Engineering & Tech'] })
    assert.equal(prof.status, 200, JSON.stringify(prof.data))
    const scribeId = prof.data.profile.id as string
    await call('POST', `/api/admin/scribes/${scribeId}/verify`, admin, { isApproved: true })

    const mine = await call('GET', '/api/referrals/me', alice)
    assert.equal(mine.status, 200)
    const code = mine.data.referral.code as string
    assert.match(code, /^SL[A-Z2-9]{6}$/)
    assert.equal((await call('GET', '/api/referrals/me', alice)).data.referral.code, code, 'code is stable')

    // Own code and unknown codes are refused.
    assert.equal((await call('POST', '/api/referrals/apply', alice, { code })).status, 400)
    assert.equal((await call('POST', '/api/referrals/apply', bob, { code: 'SLZZZZZZ' })).status, 400)

    const applied = await call('POST', '/api/referrals/apply', bob, { code: code.toLowerCase() })
    assert.equal(applied.status, 200)
    assert.equal(applied.data.credit, 50)
    assert.equal((await call('POST', '/api/referrals/apply', bob, { code })).status, 400, 'only once')

    // A Draft holds the credit; starting another order moves it to the new one.
    const draft = await newOrder(bob)
    assert.equal(draft.discount, 50)
    const order = await newOrder(bob)
    assert.equal(order.discount, 50)
    const plain = Number(order.customerTotal) + 50
    const oldDraft = await call('GET', `/api/orders/${draft.id}`, bob)
    assert.equal(Number(oldDraft.data.order.customerTotal), plain)
    assert.equal(Number(oldDraft.data.order.discount), 0)
    assert.equal(Number(order.scribePayout), order.pages * 20, 'scribe keeps ₹20 per page')

    await pay(bob, order)
    assert.equal((await call('GET', '/api/referrals/me', bob)).data.referral.canApplyCode, false)

    for (const st of ['Accepted', 'Writing', 'Dispatched']) {
      const r = await call('POST', `/api/orders/${order.id}/transition`, scribe, { nextStatus: st })
      assert.equal(r.status, 200, `${st}: ${JSON.stringify(r.data)}`)
    }
    assert.equal((await call('GET', '/api/referrals/me', alice)).data.referral.credit, 0, 'no reward before delivery')
    const del = await call('POST', `/api/orders/${order.id}/transition`, admin, { nextStatus: 'Delivered' })
    assert.equal(del.status, 200, JSON.stringify(del.data))

    const after1 = (await call('GET', '/api/referrals/me', alice)).data.referral
    assert.equal(after1.credit, 50)
    assert.equal(after1.invited, 1)
    assert.equal(after1.rewarded, 1)

    // Alice's next order uses her credit; cancelling gives it back.
    const aliceOrder = await newOrder(alice)
    assert.equal(aliceOrder.discount, 50)
    await pay(alice, aliceOrder)
    const cancel = await call('POST', `/api/orders/${aliceOrder.id}/transition`, alice, { nextStatus: 'Cancelled' })
    assert.equal(cancel.status, 200, JSON.stringify(cancel.data))
    assert.equal((await call('GET', '/api/referrals/me', alice)).data.referral.credit, 50)

    // Pilot metrics see the paid orders.
    const m = await call('GET', '/api/admin/pilot-metrics', admin)
    assert.equal(m.status, 200)
    const week = m.data.weeks[0]
    assert.equal(week.paidOrders, 2)
    assert.equal(week.delivered, 1)
    assert.equal((await call('GET', '/api/admin/pilot-metrics', bob)).status, 403)

    // The picker shows the scribe's rating once rated.
    const rate = await call('POST', `/api/orders/${order.id}/rating`, bob, { stars: 4 })
    assert.ok(rate.status === 200 || rate.status === 201, JSON.stringify(rate.data))
    const list = await call('GET', '/api/scribes')
    const card = list.data.scribes.find((x: { id: string }) => x.id === scribeId)
    assert.equal(card.rating, 4)
    assert.equal(card.ratingCount, 1)
    assert.equal(card.isSample, false)
  })

  test('demo scribes are labelled in dev and hidden in production', async () => {
    await seedDemoData(db)
    const dev = await call('GET', '/api/scribes')
    const ananya = dev.data.scribes.find((x: { id: string }) => x.id === 'S-2041')
    assert.equal(ananya?.isSample, true)

    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const prod = await call('GET', '/api/scribes')
      assert.equal(prod.data.scribes.some((x: { isSample: boolean }) => x.isSample), false)
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})
