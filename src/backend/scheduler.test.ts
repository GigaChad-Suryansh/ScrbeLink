import './testSetup'
import { beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import * as s from './scheduler'
import { seedOrder, testDb } from './testDb'
import type { Db } from './db'

const HOUR = 3_600_000
const t0 = new Date('2026-01-01T00:00:00Z')
const after = (ms: number) => new Date(t0.getTime() + ms)

let db: Db
beforeEach(async () => {
  db = await testDb()
  for (const id of ['SL-1', 'SL-2', 'SL-3']) await seedOrder(db, id)
})

describe('escrow payout clock', () => {
  test('pays the scribe after 24 hours, not before', async () => {
    await s.registerEscrowClock(db, 'SL-1', 'S-A', 100, t0)
    assert.equal(await s.runEscrowReleaseJob(db, after(23 * HOUR + 59 * 60_000)), 0)
    assert.equal(await s.runEscrowReleaseJob(db, after(24 * HOUR)), 1)
    assert.equal(await s.runEscrowReleaseJob(db, after(48 * HOUR)), 0, 'never pays twice')
  })

  test('starting the clock twice for one order keeps a single record', async () => {
    await s.registerEscrowClock(db, 'SL-1', 'S-A', 100, t0)
    await s.registerEscrowClock(db, 'SL-1', 'S-A', 100, after(5 * HOUR))
    assert.equal((await s.getEscrowRecordsFor(db, 'S-A')).length, 1)
  })

  test('an open dispute freezes the payout', async () => {
    await s.registerEscrowClock(db, 'SL-1', 'S-A', 100, t0)
    assert.equal(await s.freezeEscrow(db, 'SL-1'), true)
    assert.equal(await s.runEscrowReleaseJob(db, after(72 * HOUR)), 0)
    assert.equal((await s.getEscrowRecord(db, 'SL-1'))?.isReleased, false)
  })

  test('a ruling for the scribe releases it; refund and split do not', async () => {
    for (const [outcome, released] of [['RELEASED_TO_SCRIBE', true], ['REFUNDED_TO_CUSTOMER', false], ['SPLIT', false]] as const) {
      await db.query('DELETE FROM escrow')
      await s.registerEscrowClock(db, 'SL-1', 'S-A', 100, t0)
      await s.freezeEscrow(db, 'SL-1')
      assert.equal(await s.settleEscrow(db, 'SL-1', outcome), true)
      await s.runEscrowReleaseJob(db, after(72 * HOUR))
      assert.equal((await s.getEscrowRecord(db, 'SL-1'))?.isReleased, released, outcome)
    }
  })

  test('settling twice or without a dispute does nothing', async () => {
    await s.registerEscrowClock(db, 'SL-1', 'S-A', 100, t0)
    assert.equal(await s.settleEscrow(db, 'SL-1', 'SPLIT'), false)
    await s.freezeEscrow(db, 'SL-1')
    assert.equal(await s.settleEscrow(db, 'SL-1', 'REFUNDED_TO_CUSTOMER'), true)
    assert.equal(await s.settleEscrow(db, 'SL-1', 'RELEASED_TO_SCRIBE'), false)
    assert.equal((await s.getEscrowRecord(db, 'SL-1'))?.isReleased, false)
  })

  test('money survives as exact numbers', async () => {
    await s.registerEscrowClock(db, 'SL-1', 'S-A', 149.5, t0)
    assert.equal((await s.getEscrowRecord(db, 'SL-1'))?.amount, 149.5)
  })
})

describe('rush protocol', () => {
  test('a missed check-in past the grace period reassigns and strikes', async () => {
    await s.registerRushWatch(db, 'SL-1', 'S-A', 'S-A', after(HOUR))
    assert.deepEqual(await s.runRushMonitorJob(db, after(HOUR + 10 * 60_000)), { reassignedCount: 0, strikesGiven: 0, reassignedOrderIds: [] })
    const r = await s.runRushMonitorJob(db, after(HOUR + 20 * 60_000))
    assert.deepEqual(r, { reassignedCount: 1, strikesGiven: 1, reassignedOrderIds: ['SL-1'] })
    assert.equal((await s.getScribeStrikeInfo(db, 'S-A')).strikes, 1)
    assert.equal((await s.runRushMonitorJob(db, after(5 * HOUR))).reassignedCount, 0, 'one strike per order')
  })

  test('a check-in resets the clock', async () => {
    await s.registerRushWatch(db, 'SL-1', 'S-A', 'S-A', after(HOUR))
    await s.recordCheckIn(db, 'SL-1', after(2 * HOUR))
    assert.equal((await s.runRushMonitorJob(db, after(HOUR + 30 * 60_000))).reassignedCount, 0)
  })

  test('three strikes suspend the scribe', async () => {
    for (const id of ['SL-1', 'SL-2', 'SL-3']) await s.registerRushWatch(db, id, 'S-A', 'S-A', after(HOUR))
    await s.runRushMonitorJob(db, after(3 * HOUR))
    const info = await s.getScribeStrikeInfo(db, 'S-A')
    assert.equal(info.strikes, 3)
    assert.equal(info.isSuspended, true)
  })

  test('a closed watch never strikes, even long after the due time', async () => {
    await s.registerRushWatch(db, 'SL-1', 'S-A', 'S-A', after(HOUR))
    await s.closeRushWatch(db, 'SL-1')
    assert.equal((await s.runRushMonitorJob(db, after(10 * HOUR))).reassignedCount, 0)
    assert.equal((await s.getScribeStrikeInfo(db, 'S-A')).strikes, 0)
  })

  test('a transaction that fails changes nothing', async () => {
    await s.registerRushWatch(db, 'SL-1', 'S-A', 'S-A', after(HOUR))
    await assert.rejects(
      db.tx(async (q) => {
        await s.runRushMonitorJob(q, after(5 * HOUR))
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.equal((await s.getScribeStrikeInfo(db, 'S-A')).strikes, 0)
    assert.equal((await s.runRushMonitorJob(db, after(5 * HOUR))).reassignedCount, 1, 'the watch is still live')
  })
})
