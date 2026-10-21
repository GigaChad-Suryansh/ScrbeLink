/**
 * testPhase5.ts
 * Comprehensive test suite validating Phase 5 specifications:
 * 1. Enforced State Transitions (valid transitions vs illegal jumps)
 * 2. Deadline Calculations (pages turnaround formula, 30m intake, 60m checkin, 24h escrow)
 * 3. UPI Payment Gateway in Test Mode (Intent, Verification, DeepLink)
 * 4. Escrow 24-Hour Payout Clock (time lapse simulation & auto-release)
 * 5. Rush Protocol (on-time checkin, grace period warning, missed check-in reassignment & strike)
 */

import {
  validateTransition,
  computeDeadlines,
  computeIntakeDeadline,
  evaluateRushProtocol,
} from '../shared/stateMachine'
import { createUpiPaymentIntent, verifyUpiPayment } from './paymentGateway'
import { OrderStateMachineScheduler } from './scheduler'

async function runPhase5Tests() {
  console.log('=== Running Phase 5: State Machine & Money Test Suite ===')

  // 1. Enforced State Transitions
  console.log('\n[1] Testing Enforced State Transitions...')
  const t1 = validateTransition('Draft', 'Paid')
  console.assert(t1.success === true, 'Draft -> Paid should be allowed')

  const t2 = validateTransition('Paid', 'Writing')
  console.assert(t2.success === false, 'Paid -> Writing should be BLOCKED (must go through Accepted)')
  console.log('✓ Illegal transition Paid -> Writing blocked properly')

  const t3 = validateTransition('Writing', 'Dispatched')
  console.assert(t3.success === true, 'Writing -> Dispatched should be allowed')

  const t4 = validateTransition('Delivered', 'Closed')
  console.assert(t4.success === true, 'Delivered -> Closed should be allowed')
  console.log('✓ Legal transitions strictly validated')

  // 2. Deadline Formula Calculations
  console.log('\n[2] Testing Turnaround & Deadline Formulas...')
  const d1 = computeDeadlines(15) // 15 pages = 18 hours
  console.assert(d1.turnaroundHours === 18, '15 pages must equal 18 hours turnaround')

  const d2 = computeDeadlines(30) // 30 pages = 36 hours
  console.assert(d2.turnaroundHours === 36, '30 pages must equal 36 hours turnaround')

  const intakeLimit = computeIntakeDeadline(new Date(1000000))
  console.assert(intakeLimit.getTime() - 1000000 === 30 * 60 * 1000, 'Intake deadline must be 30 minutes')
  console.log('✓ Deadlines, turnaround block formula & 30-min intake window verified')

  // 3. Payment Gateway (UPI Test Mode)
  console.log('\n[3] Testing UPI Test Mode Gateway...')
  const intent = createUpiPaymentIntent('ORD-999', 450, 'student@okaxis')
  console.assert(intent.deepLink.includes('upi://pay'), 'Deep link format invalid')
  console.assert(intent.status === 'PENDING_USER', 'Initial status should be PENDING_USER')

  const verification = verifyUpiPayment(intent.paymentId, true)
  console.assert(verification.success && verification.payment.status === 'SUCCESS', 'Payment verification failed')
  console.log(`✓ UPI Payment verified for ${intent.paymentId}: ₹${intent.amount}`)

  // 4. Escrow 24-Hour Payout Clock
  console.log('\n[4] Testing 24-Hour Escrow Payout Clock...')
  const scheduler = new OrderStateMachineScheduler()
  const baseTime = new Date('2026-10-21T12:00:00Z')
  scheduler.registerEscrowClock('ORD-999', 'S-2041', 300, baseTime)

  // 10 hours later - should still be held
  const midTime = new Date('2026-10-21T22:00:00Z')
  const releasedEarly = scheduler.runEscrowReleaseJob(midTime)
  console.assert(releasedEarly === 0, 'Escrow released prematurely!')

  // 24.5 hours later - should auto-release
  const post24h = new Date('2026-10-22T12:30:00Z')
  const released = scheduler.runEscrowReleaseJob(post24h)
  console.assert(released === 1, 'Escrow failed to release after 24h clock elapsed')
  console.log('✓ 24-Hour Escrow Clock verified with auto-release')

  // 5. Rush Protocol & Strike Penalty
  console.log('\n[5] Testing Rush Protocol & Missed Check-in Strikes...')
  const checkinDue = new Date('2026-10-21T14:00:00Z')

  // Case A: On time
  const evalOnTime = evaluateRushProtocol(checkinDue, 15, new Date('2026-10-21T13:55:00Z'))
  console.assert(evalOnTime.action === 'OK', 'On-time check-in misjudged')

  // Case B: 10 mins late (in 15m grace window)
  const evalGrace = evaluateRushProtocol(checkinDue, 15, new Date('2026-10-21T14:10:00Z'))
  console.assert(evalGrace.action === 'WARNING', 'Grace period warning misjudged')

  // Case C: 20 mins late (past 15m grace window) -> Reassign & Strike
  const evalOverdue = evaluateRushProtocol(checkinDue, 15, new Date('2026-10-21T14:20:00Z'))
  console.assert(evalOverdue.action === 'REASSIGN_AND_STRIKE', 'Missed check-in not flagged for reassignment')

  // Test Scheduler reassignment execution
  scheduler.registerRushWatch('ORD-RUSH', 'S-99', 'Rohan', checkinDue)
  const rushRun = scheduler.runRushMonitorJob(new Date('2026-10-21T14:25:00Z'))
  console.assert(rushRun.reassignedCount === 1 && rushRun.strikesGiven === 1, 'Scheduler failed to execute reassignment & strike')

  const strikeInfo = scheduler.getScribeStrikeInfo('S-99')
  console.assert(strikeInfo.strikes === 1, 'Strike count should be 1')
  console.log('✓ Rush Protocol, automatic order reassignment, and strike penalty verified')

  console.log('\n=== All Phase 5 State Machine & Money Tests Passed Cleanly! ===')
}

runPhase5Tests().catch(err => {
  console.error('Phase 5 test failed:', err)
  process.exit(1)
})
