import './testSetup'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { OrderStateMachineScheduler } from './scheduler'

const HOUR = 3_600_000
const t0 = new Date('2026-01-01T00:00:00Z')
const after = (ms: number) => new Date(t0.getTime() + ms)

describe('escrow payout clock', () => {
  test('pays the scribe after 24 hours, not before', () => {
    const s = new OrderStateMachineScheduler()
    s.registerEscrowClock('SL-1', 'S-A', 100, t0)
    assert.equal(s.runEscrowReleaseJob(after(23 * HOUR + 59 * 60_000)), 0)
    assert.equal(s.runEscrowReleaseJob(after(24 * HOUR)), 1)
    assert.equal(s.runEscrowReleaseJob(after(48 * HOUR)), 0, 'never pays twice')
  })

  test('an open dispute freezes the payout', () => {
    const s = new OrderStateMachineScheduler()
    s.registerEscrowClock('SL-1', 'S-A', 100, t0)
    assert.equal(s.freezeEscrow('SL-1'), true)
    assert.equal(s.runEscrowReleaseJob(after(72 * HOUR)), 0)
    assert.equal(s.getEscrowRecord('SL-1')?.isReleased, false)
  })

  test('a ruling for the scribe releases it; refund and split do not', () => {
    for (const [outcome, released] of [['RELEASED_TO_SCRIBE', true], ['REFUNDED_TO_CUSTOMER', false], ['SPLIT', false]] as const) {
      const s = new OrderStateMachineScheduler()
      s.registerEscrowClock('SL-1', 'S-A', 100, t0)
      s.freezeEscrow('SL-1')
      assert.equal(s.settleEscrow('SL-1', outcome), true)
      s.runEscrowReleaseJob(after(72 * HOUR))
      assert.equal(s.getEscrowRecord('SL-1')?.isReleased, released, outcome)
    }
  })

  test('settling twice or without a dispute does nothing', () => {
    const s = new OrderStateMachineScheduler()
    s.registerEscrowClock('SL-1', 'S-A', 100, t0)
    assert.equal(s.settleEscrow('SL-1', 'SPLIT'), false)
    s.freezeEscrow('SL-1')
    assert.equal(s.settleEscrow('SL-1', 'REFUNDED_TO_CUSTOMER'), true)
    assert.equal(s.settleEscrow('SL-1', 'RELEASED_TO_SCRIBE'), false)
    assert.equal(s.getEscrowRecord('SL-1')?.isReleased, false)
  })
})

describe('rush protocol', () => {
  test('a missed check-in past the grace period reassigns and strikes', () => {
    const s = new OrderStateMachineScheduler()
    s.registerRushWatch('SL-1', 'S-A', 'S-A', after(HOUR))
    assert.deepEqual(s.runRushMonitorJob(after(HOUR + 10 * 60_000)), { reassignedCount: 0, strikesGiven: 0, reassignedOrderIds: [] })
    const r = s.runRushMonitorJob(after(HOUR + 20 * 60_000))
    assert.deepEqual(r, { reassignedCount: 1, strikesGiven: 1, reassignedOrderIds: ['SL-1'] })
    assert.equal(s.getScribeStrikeInfo('S-A').strikes, 1)
    assert.equal(s.runRushMonitorJob(after(5 * HOUR)).reassignedCount, 0, 'one strike per order')
  })

  test('a check-in resets the clock', () => {
    const s = new OrderStateMachineScheduler()
    s.registerRushWatch('SL-1', 'S-A', 'S-A', after(HOUR))
    s.recordCheckIn('SL-1', after(2 * HOUR))
    assert.equal(s.runRushMonitorJob(after(HOUR + 30 * 60_000)).reassignedCount, 0)
  })

  test('three strikes suspend the scribe', () => {
    const s = new OrderStateMachineScheduler()
    for (const id of ['SL-1', 'SL-2', 'SL-3']) s.registerRushWatch(id, 'S-A', 'S-A', after(HOUR))
    s.runRushMonitorJob(after(3 * HOUR))
    const info = s.getScribeStrikeInfo('S-A')
    assert.equal(info.strikes, 3)
    assert.equal(info.isSuspended, true)
  })
})
