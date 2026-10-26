/**
 * backend/scheduler.ts
 * Money and monitoring jobs, stored in Postgres:
 * 1. 24-hour escrow payout clock: delivered orders whose dispute window has lapsed are released.
 * 2. Rush protocol monitor: a missed hourly check-in (past the grace period) gives the scribe a
 *    strike and sends the order back to the pool.
 * Every function takes a Queryable, so a caller can run several of them in one transaction.
 */

import type { Queryable } from './db'
import { evaluateRushProtocol } from '../shared/stateMachine'

export type DisputeOutcome = 'REFUNDED_TO_CUSTOMER' | 'RELEASED_TO_SCRIBE' | 'SPLIT'

export interface EscrowRecord {
  orderId: string
  scribeId: string
  amount: number
  deliveredAt: Date
  releaseDueAt: Date
  isReleased: boolean
  isDisputed: boolean
  /** Set when an admin settles a dispute. Only RELEASED_TO_SCRIBE pays the scribe. */
  disputeOutcome?: DisputeOutcome
}

export interface ScribeStrikeLedger {
  scribeId: string
  strikes: number
  isSuspended: boolean
  logs: string[]
}

const toEscrow = (r: any): EscrowRecord => ({
  orderId: r.order_id,
  scribeId: r.scribe_id,
  amount: Number(r.amount),
  deliveredAt: r.delivered_at,
  releaseDueAt: r.release_due_at,
  isReleased: r.is_released,
  isDisputed: r.is_disputed,
  disputeOutcome: r.dispute_outcome ?? undefined,
})

export async function audit(q: Queryable, entry: string): Promise<void> {
  await q.query('INSERT INTO audit_log (entry) VALUES ($1)', [entry])
}

export async function getAuditLogs(q: Queryable, last = 10): Promise<string[]> {
  const rows = await q.query<{ at: Date; entry: string }>('SELECT at, entry FROM audit_log ORDER BY id DESC LIMIT $1', [last])
  return rows.reverse().map((r) => `[${r.at.toISOString()}] ${r.entry}`)
}

export async function registerEscrowClock(q: Queryable, orderId: string, scribeId: string, amount: number, deliveredAt = new Date()): Promise<void> {
  const releaseDueAt = new Date(deliveredAt.getTime() + 24 * 3600 * 1000)
  await q.query(
    `INSERT INTO escrow (order_id, scribe_id, amount, delivered_at, release_due_at)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING`,
    [orderId, scribeId, amount, deliveredAt, releaseDueAt],
  )
  await audit(q, `[ESCROW_CLOCK_STARTED] 24-hour payout countdown started for ${orderId} (Amount: ₹${amount})`)
}

export async function registerRushWatch(q: Queryable, orderId: string, scribeId: string, scribeName: string, nextCheckInDue: Date): Promise<void> {
  await q.query('INSERT INTO rush_watches (order_id, scribe_id, scribe_name, next_check_in_due) VALUES ($1,$2,$3,$4)', [
    orderId, scribeId, scribeName, nextCheckInDue,
  ])
  await audit(q, `[RUSH_WATCH_ACTIVE] Monitoring hourly check-in for Order ${orderId} assigned to ${scribeName}`)
}

export async function recordCheckIn(q: Queryable, orderId: string, newDeadline = new Date(Date.now() + 60 * 60 * 1000)): Promise<void> {
  const rows = await q.query('UPDATE rush_watches SET next_check_in_due = $2 WHERE order_id = $1 AND NOT is_closed RETURNING id', [orderId, newDeadline])
  if (rows.length) await audit(q, `[RUSH_CHECKIN_RECEIVED] Reset timer for ${orderId}. Next due: ${newDeadline.toISOString()}`)
}

/** Stops watching an order for check-ins. Called when it leaves the Writing state. */
export async function closeRushWatch(q: Queryable, orderId: string): Promise<void> {
  await q.query('UPDATE rush_watches SET is_closed = true WHERE order_id = $1 AND NOT is_closed', [orderId])
}

/** An open dispute freezes the payout until an admin settles it. */
export async function freezeEscrow(q: Queryable, orderId: string): Promise<boolean> {
  const rows = await q.query('UPDATE escrow SET is_disputed = true WHERE order_id = $1 AND NOT is_released RETURNING amount', [orderId])
  if (!rows.length) return false
  await audit(q, `[ESCROW_FROZEN] Dispute opened on ${orderId}. Payout of ₹${rows[0].amount} is on hold.`)
  return true
}

/** Settle a frozen payout. Only a ruling in the scribe's favour releases it. */
export async function settleEscrow(q: Queryable, orderId: string, outcome: DisputeOutcome): Promise<boolean> {
  const rows = await q.query(
    `UPDATE escrow SET dispute_outcome = $2,
       is_released = ($2 = 'RELEASED_TO_SCRIBE'),
       is_disputed = is_disputed AND $2 <> 'RELEASED_TO_SCRIBE'
     WHERE order_id = $1 AND is_disputed AND dispute_outcome IS NULL RETURNING order_id`,
    [orderId, outcome],
  )
  if (!rows.length) return false
  await audit(q, `[ESCROW_SETTLED] Dispute on ${orderId} ruled ${outcome}.`)
  return true
}

export async function getEscrowRecord(q: Queryable, orderId: string): Promise<EscrowRecord | undefined> {
  const rows = await q.query('SELECT * FROM escrow WHERE order_id = $1', [orderId])
  return rows[0] ? toEscrow(rows[0]) : undefined
}

export async function getEscrowRecordsFor(q: Queryable, scribeId: string): Promise<EscrowRecord[]> {
  return (await q.query('SELECT * FROM escrow WHERE scribe_id = $1', [scribeId])).map(toEscrow)
}

/** Releases every payout whose 24 hours are up and that is not under dispute. Returns how many. */
export async function runEscrowReleaseJob(q: Queryable, now = new Date()): Promise<number> {
  const rows = await q.query<{ order_id: string; scribe_id: string; amount: number }>(
    `UPDATE escrow SET is_released = true
     WHERE NOT is_released AND NOT is_disputed AND release_due_at <= $1
     RETURNING order_id, scribe_id, amount`,
    [now],
  )
  for (const r of rows) {
    await audit(q, `[ESCROW_AUTO_RELEASE] 24 hours elapsed without dispute. Released ₹${r.amount} to scribe ${r.scribe_id} for ${r.order_id}`)
  }
  return rows.length
}

export async function getScribeStrikeInfo(q: Queryable, scribeId: string): Promise<ScribeStrikeLedger> {
  const r = (await q.query('SELECT * FROM scribe_strikes WHERE scribe_id = $1', [scribeId]))[0]
  return r
    ? { scribeId, strikes: r.strikes, isSuspended: r.is_suspended, logs: r.logs }
    : { scribeId, strikes: 0, isSuspended: false, logs: [] }
}

/** Adds or removes strikes (never below zero). Three strikes suspend; dropping below three lifts it. */
export async function adjustStrikes(q: Queryable, scribeId: string, delta: number, note?: string): Promise<ScribeStrikeLedger> {
  const cur = await getScribeStrikeInfo(q, scribeId)
  const strikes = Math.max(0, cur.strikes + delta)
  const logs = note ? [...cur.logs, note] : cur.logs
  const isSuspended = strikes >= 3
  await q.query(
    `INSERT INTO scribe_strikes (scribe_id, strikes, is_suspended, logs) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (scribe_id) DO UPDATE SET strikes = $2, is_suspended = $3, logs = $4::jsonb`,
    [scribeId, strikes, isSuspended, JSON.stringify(logs)],
  )
  if (isSuspended && !cur.isSuspended) await audit(q, `[SCRIBE_SUSPENDED] Scribe ${scribeId} reached 3 strikes! Account suspended.`)
  return { scribeId, strikes, isSuspended, logs }
}

/** Checks every active hourly check-in. Run it inside one transaction. */
export async function runRushMonitorJob(
  q: Queryable,
  now = new Date(),
): Promise<{ reassignedCount: number; strikesGiven: number; reassignedOrderIds: string[] }> {
  const watches = await q.query<{ id: number; order_id: string; scribe_id: string; next_check_in_due: Date }>(
    'SELECT id, order_id, scribe_id, next_check_in_due FROM rush_watches WHERE NOT is_closed ORDER BY id',
  )
  const reassignedOrderIds: string[] = []
  for (const w of watches) {
    const evaluation = evaluateRushProtocol(w.next_check_in_due, 15, now)
    if (evaluation.action !== 'REASSIGN_AND_STRIKE') continue

    await q.query('UPDATE rush_watches SET is_closed = true WHERE id = $1', [w.id])
    reassignedOrderIds.push(w.order_id)
    const cur = await getScribeStrikeInfo(q, w.scribe_id)
    await adjustStrikes(q, w.scribe_id, 1, `Strike #${cur.strikes + 1} issued: missed hourly check-in on order ${w.order_id}`)
    await audit(q, `[RUSH_REASSIGNMENT] ${evaluation.reason} (Order ${w.order_id} returned to campus pool)`)
  }
  return { reassignedCount: reassignedOrderIds.length, strikesGiven: reassignedOrderIds.length, reassignedOrderIds }
}
