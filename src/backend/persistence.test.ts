import './testSetup'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDb } from './db'
import * as l from './logisticsService'
import * as s from './scheduler'
import { seedOrder } from './testDb'

describe('data survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribelink-db-'))
  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('orders, escrow, scribes and strikes are still there after closing and reopening', async () => {
    const first = await createDb({ dataDir: dir })
    await seedOrder(first, 'SL-KEEP')
    await s.registerEscrowClock(first, 'SL-KEEP', 'S-KEEP01', 149.5)
    await l.upsertScribe(first, { scribeId: 'S-KEEP01', phone: '+919000000077', name: 'Kept', college: 'DTU', sampleCardText: 'A sample that stays', upiVpa: 'k@okaxis', specialties: [] })
    await l.manageScribeStrike(first, 'S-KEEP01', 2)
    await first.close()

    const second = await createDb({ dataDir: dir })
    assert.equal((await second.query('SELECT status FROM orders WHERE id = $1', ['SL-KEEP']))[0].status, 'Paid')
    assert.equal((await s.getEscrowRecord(second, 'SL-KEEP'))?.amount, 149.5)
    const scribe = await l.getScribe(second, 'S-KEEP01')
    assert.equal(scribe?.name, 'Kept')
    assert.equal(scribe?.strikes, 2)
    assert.equal((await second.query('SELECT count(*)::int AS n FROM schema_migrations'))[0].n, 1, 'migrations are not applied twice')
    await second.close()
  })
})

describe('transactions', () => {
  test('a failed transaction leaves nothing behind', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scribelink-db-'))
    const db = await createDb({ dataDir: dir2 })
    try {
      await assert.rejects(
        db.tx(async (q) => {
          await seedOrder(q, 'SL-ROLLBACK')
          throw new Error('stop')
        }),
        /stop/,
      )
      assert.equal((await db.query('SELECT 1 FROM orders WHERE id = $1', ['SL-ROLLBACK'])).length, 0)
    } finally {
      await db.close()
      fs.rmSync(dir2, { recursive: true, force: true })
    }
  })
})
