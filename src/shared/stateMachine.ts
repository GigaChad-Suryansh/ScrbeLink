/**
 * shared/stateMachine.ts
 * Rigorous Order State Machine & Money Protocol implementation for Phase 5:
 *
 * 1. Enforced State Transitions:
 *    Draft -> Paid -> Accepted -> Writing -> Dispatched -> Delivered -> Closed
 *    Failure/Dispute branches: Cancelled, Reassigned, Disputed
 *
 * 2. Deadline Formula:
 *    turnaroundHours = (pages / 15) * 18
 *    intakeDeadline = acceptedAt + 30 minutes
 *    checkinWindow = 60 minutes
 *
 * 3. Rush Protocol:
 *    - Hourly check-in timer during Writing state.
 *    - Missed check-in (grace period exceeded) triggers automatic reassignment
 *      and increments a strike on the scribe's record (3 strikes = suspension).
 *
 * 4. Escrow & 24-Hour Payout Clock:
 *    - Funds locked upon 'Paid'.
 *    - 24-hour countdown starts at 'Delivered'.
 *    - Auto-releases to Scribe's UPI VPA when payout clock expires without dispute.
 */

export type OrderStateEnum =
  | 'Draft'
  | 'Paid'
  | 'Accepted'
  | 'Writing'
  | 'Dispatched'
  | 'Delivered'
  | 'Disputed'
  | 'Reassigned'
  | 'Closed'
  | 'Cancelled'

export interface StateTransitionResult {
  success: boolean
  fromState: OrderStateEnum
  toState: OrderStateEnum
  error?: string
  auditLog: string
}

/** Allowed state transitions graph */
export const ALLOWED_TRANSITIONS: Record<OrderStateEnum, OrderStateEnum[]> = {
  Draft: ['Paid', 'Cancelled'],
  Paid: ['Accepted', 'Cancelled'],
  Accepted: ['Writing', 'Reassigned', 'Cancelled'],
  Writing: ['Dispatched', 'Reassigned', 'Cancelled'],
  Dispatched: ['Delivered', 'Disputed'],
  Delivered: ['Closed', 'Disputed'],
  Disputed: ['Closed', 'Cancelled'],
  Reassigned: ['Accepted', 'Cancelled'],
  Closed: [],
  Cancelled: [],
}

/** Enforces state machine progression */
export function validateTransition(from: OrderStateEnum, to: OrderStateEnum): StateTransitionResult {
  const validDestinations = ALLOWED_TRANSITIONS[from] || []
  if (!validDestinations.includes(to)) {
    return {
      success: false,
      fromState: from,
      toState: to,
      error: `Illegal state transition from ${from} to ${to}. Allowed transitions: [${validDestinations.join(', ')}]`,
      auditLog: `[SECURITY/REJECTED] Attempted invalid transition ${from} -> ${to}`,
    }
  }

  return {
    success: true,
    fromState: from,
    toState: to,
    auditLog: `[STATE_TRANSITION] Successfully advanced ${from} -> ${to}`,
  }
}

/** Deadline calculation based on pages count */
export function computeDeadlines(pages: number, startTime = new Date()) {
  const turnaroundHrs = (pages / 15) * 18
  const finalDeadline = new Date(startTime.getTime() + turnaroundHrs * 3600 * 1000)
  return {
    turnaroundHours: turnaroundHrs,
    finalDeadline,
    formattedFinalDeadline: finalDeadline.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  }
}

/** 30-minute intake window calculator */
export function computeIntakeDeadline(acceptedAt = new Date()): Date {
  return new Date(acceptedAt.getTime() + 30 * 60 * 1000)
}

/** Hourly check-in due timestamp */
export function computeNextCheckInDeadline(lastCheckInAt = new Date()): Date {
  return new Date(lastCheckInAt.getTime() + 60 * 60 * 1000)
}

/** 24-hour Escrow Payout Clock */
export function computeEscrowReleaseDeadline(deliveredAt = new Date()): Date {
  return new Date(deliveredAt.getTime() + 24 * 60 * 60 * 1000)
}

// ── Rush Protocol: Missed Check-in Evaluator ─────────────────────────────────

export interface RushEvaluationResult {
  isOverdue: boolean
  minutesOverdue: number
  action: 'OK' | 'WARNING' | 'REASSIGN_AND_STRIKE'
  reason?: string
}

export function evaluateRushProtocol(
  nextCheckInDue: Date,
  graceMinutes = 15,
  currentTime = new Date()
): RushEvaluationResult {
  const diffMs = currentTime.getTime() - nextCheckInDue.getTime()
  const minutesOverdue = Math.floor(diffMs / 60000)

  if (minutesOverdue <= 0) {
    return { isOverdue: false, minutesOverdue: 0, action: 'OK' }
  }

  if (minutesOverdue <= graceMinutes) {
    return {
      isOverdue: true,
      minutesOverdue,
      action: 'WARNING',
      reason: `Hourly check-in is overdue by ${minutesOverdue} min (Grace window: ${graceMinutes} min remaining before reassignment).`,
    }
  }

  return {
    isOverdue: true,
    minutesOverdue,
    action: 'REASSIGN_AND_STRIKE',
    reason: `Scribe missed check-in threshold by ${minutesOverdue} mins. Reassigning order and issuing 1 strike.`,
  }
}
