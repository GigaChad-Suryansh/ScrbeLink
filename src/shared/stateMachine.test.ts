import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALLOWED_TRANSITIONS,
  computeDeadlines,
  computeEscrowReleaseDeadline,
  computeIntakeDeadline,
  computeNextCheckInDeadline,
  evaluateRushProtocol,
  validateTransition,
  type OrderStateEnum,
} from './stateMachine'

const states = Object.keys(ALLOWED_TRANSITIONS) as OrderStateEnum[]

describe('state machine', () => {
  test('every state can only move to the states the graph allows', () => {
    for (const from of states) {
      for (const to of states) {
        const allowed = ALLOWED_TRANSITIONS[from].includes(to)
        assert.equal(validateTransition(from, to).success, allowed, `${from} -> ${to}`)
      }
    }
  })

  test('the happy path is legal end to end', () => {
    const path: OrderStateEnum[] = ['Paid', 'Accepted', 'Writing', 'Dispatched', 'Delivered', 'Closed']
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(validateTransition(path[i], path[i + 1]).success, true, `${path[i]} -> ${path[i + 1]}`)
    }
  })

  test('steps cannot be skipped', () => {
    assert.equal(validateTransition('Paid', 'Writing').success, false)
    assert.equal(validateTransition('Writing', 'Delivered').success, false)
    assert.equal(validateTransition('Accepted', 'Dispatched').success, false)
  })

  test('Closed and Cancelled are final', () => {
    assert.deepEqual(ALLOWED_TRANSITIONS.Closed, [])
    assert.deepEqual(ALLOWED_TRANSITIONS.Cancelled, [])
  })

  test('only delivered or dispatched orders can be disputed', () => {
    const canDispute = states.filter((s) => ALLOWED_TRANSITIONS[s].includes('Disputed')).sort()
    assert.deepEqual(canDispute, ['Delivered', 'Dispatched'])
  })

  test('rejections explain themselves', () => {
    const r = validateTransition('Paid', 'Closed')
    assert.equal(r.success, false)
    assert.match(r.error ?? '', /Illegal state transition/)
  })
})

describe('timing rules', () => {
  const t0 = new Date('2026-01-01T00:00:00Z')

  test('turnaround is 18 hours per 15 pages', () => {
    assert.equal(computeDeadlines(15, t0).turnaroundHours, 18)
    assert.equal(computeDeadlines(15, t0).finalDeadline.toISOString(), '2026-01-01T18:00:00.000Z')
  })

  test('intake window is 30 minutes, check-ins hourly, escrow 24 hours', () => {
    assert.equal(computeIntakeDeadline(t0).toISOString(), '2026-01-01T00:30:00.000Z')
    assert.equal(computeNextCheckInDeadline(t0).toISOString(), '2026-01-01T01:00:00.000Z')
    assert.equal(computeEscrowReleaseDeadline(t0).toISOString(), '2026-01-02T00:00:00.000Z')
  })

  test('rush protocol: on time, warning, then reassign after the grace period', () => {
    const due = new Date('2026-01-01T01:00:00Z')
    const at = (min: number) => new Date(due.getTime() + min * 60_000)
    assert.equal(evaluateRushProtocol(due, 15, at(-5)).action, 'OK')
    assert.equal(evaluateRushProtocol(due, 15, at(5)).action, 'WARNING')
    assert.equal(evaluateRushProtocol(due, 15, at(16)).action, 'REASSIGN_AND_STRIKE')
  })
})
