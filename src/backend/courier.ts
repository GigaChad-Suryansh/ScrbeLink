/**
 * backend/courier.ts
 * Handing a finished parcel to a rider (Porter or similar) without needing the courier's API.
 *
 *   1. The scribe packs the pages and asks for a pickup. A pickup code is made for the scribe.
 *   2. An admin books a rider in the courier's own app and enters the rider's details here.
 *      This makes a private link for the rider.
 *   3. At the scribe, the rider opens the link and types the pickup code the scribe reads out.
 *   4. At the gate, the rider types the delivery code the recipient reads out.
 *
 * Codes are what prove each handover, so no one can mark a parcel picked up or delivered
 * just by saying so. When a courier API is available, only step 2 needs to change.
 */

import type { CourierTask } from '../shared/logisticsDisputes'
import type { Queryable } from './db'
import { constantTimeEqual, randomDigits, randomToken } from '../shared/random'

/** 'simulated' keeps the old instant demo flow. 'manual' is the real one. */
export const courierProvider = (env = process.env): 'simulated' | 'manual' =>
  env.COURIER_PROVIDER === 'manual' || (env.COURIER_PROVIDER === undefined && env.NODE_ENV === 'production') ? 'manual' : 'simulated'

/** After this many riders have failed, stop rebooking automatically and ask an admin to look. */
export const MAX_ATTEMPTS = 3

const log = (t: CourierTask, event: string) => { t.history = [...(t.history ?? []), { at: new Date().toISOString(), event }] }

async function save(q: Queryable, t: CourierTask) {
  await q.query('UPDATE courier_tasks SET task = $2::jsonb WHERE order_id = $1', [t.orderId, JSON.stringify(t)])
}

export async function getTask(q: Queryable, orderId: string): Promise<CourierTask | undefined> {
  return (await q.query<{ task: CourierTask }>('SELECT task FROM courier_tasks WHERE order_id = $1', [orderId]))[0]?.task
}

export async function getTaskByToken(q: Queryable, token: string): Promise<CourierTask | undefined> {
  return (await q.query<{ task: CourierTask }>(`SELECT task FROM courier_tasks WHERE task->>'riderToken' = $1`, [token]))[0]?.task
}

export async function requestPickup(
  q: Queryable,
  o: { orderId: string; pickupAddress: string; dropGate: string; deliveryOtp: string; pickupContact?: CourierTask['pickupContact']; dropContact?: CourierTask['dropContact'] },
): Promise<CourierTask> {
  const task: CourierTask = {
    trackingId: `PICKUP-${o.orderId}`,
    courierPartner: 'Porter',
    orderId: o.orderId,
    pickupAddress: o.pickupAddress,
    dropGate: o.dropGate,
    courierRiderName: '',
    courierRiderPhone: '',
    deliveryOtp: o.deliveryOtp,
    status: 'BOOKING_REQUESTED',
    createdAt: new Date().toISOString(),
    pickupOtp: randomDigits(6),
    pickupContact: o.pickupContact,
    dropContact: o.dropContact,
    attempts: 1,
  }
  log(task, 'Pickup requested by the scribe')
  await q.query('INSERT INTO courier_tasks (order_id, task) VALUES ($1,$2::jsonb) ON CONFLICT (order_id) DO UPDATE SET task = $2::jsonb', [o.orderId, JSON.stringify(task)])
  return task
}

export async function assignRider(q: Queryable, orderId: string, r: { name: string; phone: string; trackingUrl?: string; trackingId?: string }): Promise<CourierTask> {
  const t = await getTask(q, orderId)
  if (!t || t.status !== 'BOOKING_REQUESTED') throw new Error('This order is not waiting for a rider')
  t.status = 'RIDER_ASSIGNED'
  t.courierRiderName = r.name
  t.courierRiderPhone = r.phone
  t.trackingUrl = r.trackingUrl
  if (r.trackingId) t.trackingId = r.trackingId
  t.riderToken = randomToken(18)
  log(t, `Rider ${r.name} assigned`)
  await save(q, t)
  return t
}

/** The rider could not collect or deliver. The parcel goes back in the queue for a new rider. */
export async function rebook(q: Queryable, orderId: string, reason: string): Promise<{ task: CourierTask; needsAttention: boolean }> {
  const t = await getTask(q, orderId)
  if (!t || !['BOOKING_REQUESTED', 'RIDER_ASSIGNED', 'PICKED_UP'].includes(t.status)) throw new Error('Nothing to rebook for this order')
  log(t, `Rebooking: ${reason}`)
  t.attempts = (t.attempts ?? 1) + 1
  t.status = 'BOOKING_REQUESTED'
  t.riderToken = undefined
  t.courierRiderName = ''
  t.courierRiderPhone = ''
  t.trackingUrl = undefined
  await save(q, t)
  return { task: t, needsAttention: t.attempts > MAX_ATTEMPTS }
}

export async function confirmPickup(q: Queryable, task: CourierTask, code: string): Promise<{ ok: boolean; error?: string }> {
  if (task.status !== 'RIDER_ASSIGNED') return { ok: false, error: 'This parcel is not ready for pickup' }
  if (!task.pickupOtp || !constantTimeEqual(task.pickupOtp, code.trim())) return { ok: false, error: 'That pickup code is not right. Ask the scribe to read it from their screen.' }
  task.status = 'PICKED_UP'
  task.pickedUpAt = new Date().toISOString()
  log(task, 'Picked up from the scribe')
  await save(q, task)
  return { ok: true }
}

/** What a scribe may see: their own pickup code, never the delivery code or the rider's secret link. */
export const scribeView = (t: CourierTask) => ({
  status: t.status, pickupOtp: t.status === 'DELIVERED_AT_GATE' ? undefined : t.pickupOtp, riderName: t.courierRiderName || undefined,
  riderPhone: t.courierRiderPhone || undefined, trackingUrl: t.trackingUrl, attempts: t.attempts,
})

/** What a customer may see. */
export const customerView = (t: CourierTask) => ({
  status: t.status, riderName: t.courierRiderName || undefined, riderPhone: t.courierRiderPhone || undefined,
  trackingUrl: t.trackingUrl, pickedUpAt: t.pickedUpAt, deliveredAt: t.deliveredAt,
})

/** What the rider sees on their private page. Contacts are there so they can call at each end. */
export const riderView = (t: CourierTask) => ({
  orderId: t.orderId, status: t.status, pickupAddress: t.pickupAddress, dropGate: t.dropGate,
  pickupContact: t.pickupContact, dropContact: t.dropContact,
})
