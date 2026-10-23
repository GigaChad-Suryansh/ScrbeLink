import './testSetup'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { LogisticsService } from './logisticsService'

describe('courier handover', () => {
  test('dispatch creates a task with a 6-digit OTP, or reuses the order OTP', () => {
    const l = new LogisticsService()
    const t = l.createCourierDispatch('ORD-1', 'Gate 2', 'Hostel 1', 'Borzo')
    assert.match(t.trackingId, /^BORZO-\d{6}$/)
    assert.match(t.deliveryOtp, /^\d{6}$/)
    assert.equal(t.status, 'OUT_FOR_DELIVERY')
    assert.equal(l.createCourierDispatch('ORD-2', 'Gate 2', 'Hostel 1', 'Porter', '482910').deliveryOtp, '482910')
  })

  test('a wrong OTP is refused; the right one confirms the drop', () => {
    const l = new LogisticsService()
    const t = l.createCourierDispatch('ORD-1', 'Gate 2', 'Hostel 1', 'Borzo', '482910')
    assert.equal(l.confirmGateDelivery('ORD-1', '000000').success, false)
    assert.equal(l.getCourierTask('ORD-1')?.status, 'OUT_FOR_DELIVERY')
    const ok = l.confirmGateDelivery('ORD-1', t.deliveryOtp, 'https://cdn.scribelink.in/drop/1.jpg')
    assert.equal(ok.success, true)
    assert.equal(ok.task?.status, 'DELIVERED_AT_GATE')
  })

  test('a non-string OTP is refused instead of crashing', () => {
    const l = new LogisticsService()
    l.createCourierDispatch('ORD-1', 'Gate 2', 'Hostel 1', 'Borzo', '482910')
    assert.equal(l.confirmGateDelivery('ORD-1', 482910 as unknown as string).success, false)
  })

  test('unknown orders are refused', () => {
    assert.equal(new LogisticsService().confirmGateDelivery('NOPE', '123456').success, false)
  })

  test('notifications go to the order owner, not a shared demo number', () => {
    const l = new LogisticsService()
    l.createCourierDispatch('ORD-1', 'Gate 2', 'Hostel 1', 'Borzo', '482910', '+919111111111')
    assert.equal(l.getNotificationLogs()[0].recipient, '+919111111111')
  })
})

describe('disputes and admin actions', () => {
  test('dispute IDs are unique and the scribe is shown by ID only', () => {
    const l = new LogisticsService()
    const ids = new Set<string>()
    for (let i = 0; i < 200; i++) ids.add(l.fileDispute(`ORD-${i}`, 'MISSING_PAGES', 'https://cdn.scribelink.in/v.mp4', '', 'Student', 'S-AAAAAA', 100).id)
    assert.equal(ids.size, 200)
    assert.equal(l.getAllDisputes().find((d) => d.orderId === 'ORD-0')?.scribeName, 'S-AAAAAA')
  })

  test('resolving records the decision', () => {
    const l = new LogisticsService()
    const d = l.fileDispute('ORD-1', 'MISSING_PAGES', 'https://cdn.scribelink.in/v.mp4', '', 'Student', 'S-AAAAAA', 100)
    const r = l.resolveDispute(d.id, 'REFUNDED_TO_CUSTOMER', 'Pages missing')
    assert.equal(r.status, 'REFUNDED_TO_CUSTOMER')
    assert.ok(r.resolvedAt)
    assert.throws(() => l.resolveDispute('DISP-NOPE', 'SPLIT', ''), /not found/)
  })

  test('three strikes suspend a scribe, removing one lifts it, strikes never go below zero', () => {
    const l = new LogisticsService()
    const id = l.getAllScribes()[0].scribeId
    const start = l.getAllScribes()[0].strikes
    l.manageScribeStrike(id, 3 - start)
    assert.equal(l.getAllScribes()[0].isSuspended, true)
    l.manageScribeStrike(id, -1)
    assert.equal(l.getAllScribes()[0].isSuspended, false)
    l.manageScribeStrike(id, -99)
    assert.equal(l.getAllScribes()[0].strikes, 0)
  })

  test('approving a handwriting card', () => {
    const l = new LogisticsService()
    const id = l.getAllScribes()[0].scribeId
    assert.equal(l.verifyScribeCard(id, true).isApproved, true)
    assert.equal(l.verifyScribeCard(id, false).isApproved, false)
    assert.throws(() => l.verifyScribeCard('S-NOPE', true), /not found/)
  })
})
