import './testSetup'
import { beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import * as l from './logisticsService'
import { seedOrder, testDb } from './testDb'
import type { Db } from './db'

let db: Db
beforeEach(async () => {
  db = await testDb()
  for (const id of ['ORD-1', 'ORD-2', 'ORD-3']) await seedOrder(db, id)
})

describe('courier handover', () => {
  test('dispatch creates a task with a 6-digit OTP, or reuses the order OTP', async () => {
    const t = await l.createCourierDispatch(db, 'ORD-1', 'Gate 2', 'Hostel 1', 'Borzo')
    assert.match(t.trackingId, /^BORZO-\d{6}$/)
    assert.match(t.deliveryOtp, /^\d{6}$/)
    assert.equal(t.status, 'OUT_FOR_DELIVERY')
    assert.equal((await l.createCourierDispatch(db, 'ORD-2', 'Gate 2', 'Hostel 1', 'Porter', '482910')).deliveryOtp, '482910')
  })

  test('a wrong OTP is refused; the right one confirms the drop', async () => {
    const t = await l.createCourierDispatch(db, 'ORD-1', 'Gate 2', 'Hostel 1', 'Borzo', '482910')
    assert.equal((await l.confirmGateDelivery(db, 'ORD-1', '000000')).success, false)
    assert.equal((await l.getCourierTask(db, 'ORD-1'))?.status, 'OUT_FOR_DELIVERY')
    const ok = await l.confirmGateDelivery(db, 'ORD-1', t.deliveryOtp, 'https://cdn.scribelink.in/drop/1.jpg')
    assert.equal(ok.success, true)
    assert.equal(ok.task?.status, 'DELIVERED_AT_GATE')
    assert.equal((await l.getCourierTask(db, 'ORD-1'))?.status, 'DELIVERED_AT_GATE', 'saved')
  })

  test('a non-string OTP is refused instead of crashing', async () => {
    await l.createCourierDispatch(db, 'ORD-1', 'Gate 2', 'Hostel 1', 'Borzo', '482910')
    assert.equal((await l.confirmGateDelivery(db, 'ORD-1', 482910 as unknown as string)).success, false)
  })

  test('unknown orders are refused', async () => {
    assert.equal((await l.confirmGateDelivery(db, 'NOPE', '123456')).success, false)
  })

  test('notifications go to the order owner, not a shared demo number', async () => {
    await l.createCourierDispatch(db, 'ORD-1', 'Gate 2', 'Hostel 1', 'Borzo', '482910', '+919111111111')
    assert.equal((await l.getNotificationLogs(db))[0].recipient, '+919111111111')
  })
})

describe('disputes and admin actions', () => {
  test('dispute IDs are unique and the scribe is shown by ID only', async () => {
    const ids = new Set<string>()
    for (let i = 0; i < 60; i++) {
      await seedOrder(db, `BULK-${i}`)
      ids.add((await l.fileDispute(db, `BULK-${i}`, 'MISSING_PAGES', 'https://cdn.scribelink.in/v.mp4', '', 'Student', 'S-AAAAAA', 100)).id)
    }
    assert.equal(ids.size, 60)
    assert.equal((await l.getAllDisputes(db)).find((d) => d.orderId === 'BULK-0')?.scribeName, 'S-AAAAAA')
  })

  test('only one dispute can be open per order', async () => {
    await l.fileDispute(db, 'ORD-1', 'OTHER', 'https://cdn.scribelink.in/v.mp4', '', 'Student', 'S-A', 100)
    await assert.rejects(l.fileDispute(db, 'ORD-1', 'OTHER', 'https://cdn.scribelink.in/v.mp4', '', 'Student', 'S-A', 100))
  })

  test('resolving records the decision', async () => {
    const d = await l.fileDispute(db, 'ORD-1', 'MISSING_PAGES', 'https://cdn.scribelink.in/v.mp4', '', 'Student', 'S-AAAAAA', 100)
    const r = await l.resolveDispute(db, d.id, 'REFUNDED_TO_CUSTOMER', 'Pages missing')
    assert.equal(r.status, 'REFUNDED_TO_CUSTOMER')
    assert.ok(r.resolvedAt)
    assert.equal((await l.getAllDisputes(db))[0].status, 'REFUNDED_TO_CUSTOMER', 'saved')
    await assert.rejects(l.resolveDispute(db, 'DISP-NOPE', 'SPLIT', ''), /not found/)
  })

  const profile = { scribeId: 'S-TEST01', phone: '+919000000099', name: 'Test', college: 'DTU', sampleCardText: 'Some sample text here', upiVpa: 'a@okaxis', specialties: ['Science'] }

  test('a new scribe starts unapproved; changing the sample card needs approval again', async () => {
    const created = await l.upsertScribe(db, profile)
    assert.equal(created.isApproved, false)
    assert.equal((await l.verifyScribeCard(db, 'S-TEST01', true)).isApproved, true)
    assert.equal((await l.upsertScribe(db, { ...profile, upiVpa: 'b@okaxis' })).isApproved, true, 'a UPI change keeps approval')
    assert.equal((await l.upsertScribe(db, { ...profile, sampleCardText: 'A different sample text' })).isApproved, false)
    await assert.rejects(l.verifyScribeCard(db, 'S-NOPE', true), /not found/)
  })

  test('three strikes suspend a scribe, removing one lifts it, strikes never go below zero', async () => {
    await l.upsertScribe(db, profile)
    await l.manageScribeStrike(db, 'S-TEST01', 3)
    assert.equal((await l.getScribe(db, 'S-TEST01'))?.isSuspended, true)
    await l.manageScribeStrike(db, 'S-TEST01', -1)
    assert.equal((await l.getScribe(db, 'S-TEST01'))?.isSuspended, false)
    await l.manageScribeStrike(db, 'S-TEST01', -99)
    assert.equal((await l.getScribe(db, 'S-TEST01'))?.strikes, 0)
  })
})
