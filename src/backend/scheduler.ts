/**
 * backend/scheduler.ts
 * Background Cron & Scheduled Job Simulator for:
 * 1. 24-Hour Escrow Payout Clock:
 *    Scans delivered orders whose 24-hour dispute window has lapsed and releases funds.
 *
 * 2. Rush Protocol Monitor:
 *    Scans active 'Writing' orders. If an hourly check-in deadline has expired
 *    past the 15-minute grace period, auto-reassigns the order to the campus pool
 *    and issues a strike to the scribe.
 */

import { evaluateRushProtocol } from '../shared/stateMachine'

export interface ManagedEscrowRecord {
  orderId: string
  scribeId: string
  amount: number
  deliveredAt: Date
  releaseDueAt: Date
  isReleased: boolean
  isDisputed: boolean
  /** Set when an admin settles a dispute. Only RELEASED_TO_SCRIBE pays the scribe. */
  disputeOutcome?: 'REFUNDED_TO_CUSTOMER' | 'RELEASED_TO_SCRIBE' | 'SPLIT'
}

export interface ActiveRushWatch {
  orderId: string
  scribeId: string
  scribeName: string
  nextCheckInDue: Date
  isReassigned: boolean
}

export interface ScribeStrikeLedger {
  scribeId: string
  strikes: number
  isSuspended: boolean
  logs: string[]
}

export class OrderStateMachineScheduler {
  private escrowRecords: ManagedEscrowRecord[] = []
  private rushWatches: ActiveRushWatch[] = []
  private scribeStrikes = new Map<string, ScribeStrikeLedger>()
  private auditLog: string[] = []

  registerEscrowClock(orderId: string, scribeId: string, amount: number, deliveredAt = new Date()) {
    const releaseDueAt = new Date(deliveredAt.getTime() + 24 * 3600 * 1000)
    this.escrowRecords.push({
      orderId,
      scribeId,
      amount,
      deliveredAt,
      releaseDueAt,
      isReleased: false,
      isDisputed: false,
    })
    this.log(`[ESCROW_CLOCK_STARTED] 24-hour payout countdown started for ${orderId} (Amount: ₹${amount})`)
  }

  registerRushWatch(orderId: string, scribeId: string, scribeName: string, nextCheckInDue: Date) {
    this.rushWatches.push({
      orderId,
      scribeId,
      scribeName,
      nextCheckInDue,
      isReassigned: false,
    })
    this.log(`[RUSH_WATCH_ACTIVE] Monitoring hourly check-in for Order ${orderId} assigned to ${scribeName}`)
  }

  recordCheckIn(orderId: string, newDeadline = new Date(Date.now() + 60 * 60 * 1000)) {
    const watch = this.rushWatches.find(w => w.orderId === orderId && !w.isReassigned)
    if (watch) {
      watch.nextCheckInDue = newDeadline
      this.log(`[RUSH_CHECKIN_RECEIVED] Reset timer for ${orderId}. Next due: ${newDeadline.toISOString()}`)
    }
  }

  /** An open dispute freezes the payout until an admin settles it. */
  freezeEscrow(orderId: string): boolean {
    const record = this.escrowRecords.find(r => r.orderId === orderId && !r.isReleased)
    if (!record) return false
    record.isDisputed = true
    this.log(`[ESCROW_FROZEN] Dispute opened on ${orderId}. Payout of ₹${record.amount} is on hold.`)
    return true
  }

  /** Settle a frozen payout. Only a ruling in the scribe's favour releases it. */
  settleEscrow(orderId: string, outcome: 'REFUNDED_TO_CUSTOMER' | 'RELEASED_TO_SCRIBE' | 'SPLIT'): boolean {
    const record = this.escrowRecords.find(r => r.orderId === orderId && r.isDisputed && !r.disputeOutcome)
    if (!record) return false
    record.disputeOutcome = outcome
    if (outcome === 'RELEASED_TO_SCRIBE') {
      record.isDisputed = false
      record.isReleased = true
    }
    this.log(`[ESCROW_SETTLED] Dispute on ${orderId} ruled ${outcome}.`)
    return true
  }

  getEscrowRecord(orderId: string): ManagedEscrowRecord | undefined {
    return this.escrowRecords.find(r => r.orderId === orderId)
  }

  /** Run the 24-hour Escrow Job */
  runEscrowReleaseJob(simulatedCurrentTime = new Date()): number {
    let releasedCount = 0
    for (const record of this.escrowRecords) {
      if (!record.isReleased && !record.isDisputed) {
        if (simulatedCurrentTime.getTime() >= record.releaseDueAt.getTime()) {
          record.isReleased = true
          releasedCount++
          this.log(`[ESCROW_AUTO_RELEASE] 24 hours elapsed without dispute. Released ₹${record.amount} to scribe ${record.scribeId} for ${record.orderId}`)
        }
      }
    }
    return releasedCount
  }

  /** Run the Hourly Rush Protocol Job */
  runRushMonitorJob(simulatedCurrentTime = new Date()): { reassignedCount: number; strikesGiven: number; reassignedOrderIds: string[] } {
    let reassignedCount = 0
    let strikesGiven = 0
    const reassignedOrderIds: string[] = []

    for (const watch of this.rushWatches) {
      if (watch.isReassigned) continue

      const evaluation = evaluateRushProtocol(watch.nextCheckInDue, 15, simulatedCurrentTime)

      if (evaluation.action === 'REASSIGN_AND_STRIKE') {
        watch.isReassigned = true
        reassignedCount++
        reassignedOrderIds.push(watch.orderId)
        strikesGiven++

        // Strike penalty
        const scribeRec = this.scribeStrikes.get(watch.scribeId) || {
          scribeId: watch.scribeId,
          strikes: 0,
          isSuspended: false,
          logs: [],
        }

        scribeRec.strikes += 1
        const strikeNote = `Strike #${scribeRec.strikes} issued: missed hourly check-in on order ${watch.orderId}`
        scribeRec.logs.push(strikeNote)

        if (scribeRec.strikes >= 3) {
          scribeRec.isSuspended = true
          this.log(`[SCRIBE_SUSPENDED] Scribe ${watch.scribeId} reached 3 strikes! Account suspended.`)
        }

        this.scribeStrikes.set(watch.scribeId, scribeRec)
        this.log(`[RUSH_REASSIGNMENT] ${evaluation.reason} (Order ${watch.orderId} returned to campus pool)`)
      }
    }

    return { reassignedCount, strikesGiven, reassignedOrderIds }
  }

  getScribeStrikeInfo(scribeId: string): ScribeStrikeLedger {
    return this.scribeStrikes.get(scribeId) || { scribeId, strikes: 0, isSuspended: false, logs: [] }
  }

  getAuditLogs(): string[] {
    return [...this.auditLog]
  }

  private log(entry: string) {
    this.auditLog.push(`[${new Date().toISOString()}] ${entry}`)
  }
}

export const globalScheduler = new OrderStateMachineScheduler()
