/**
 * ScribePickup.tsx
 * The scribe's side of handing pages to a rider: pack, ask for a pickup, then read the pickup
 * code to the rider when they arrive.
 */

import { useState } from 'react'
import { useCourier } from '../lib/useCourier'

const CHECKLIST = [
  'Every page is numbered and in order',
  'The pages are sealed in an envelope',
  'The order number is written on the envelope',
]

export default function ScribePickup({ orderId, busy, onAsk }: { orderId: string; busy: boolean; onAsk: () => void }) {
  const courier = useCourier(orderId, 'scribe')
  const [ticked, setTicked] = useState<boolean[]>(CHECKLIST.map(() => false))

  if (courier === undefined) return null

  if (!courier) {
    return (
      <div className="pickup-panel">
        <strong>Before you ask for a pickup</strong>
        {CHECKLIST.map((item, i) => (
          <label key={item} className="pickup-check">
            <input type="checkbox" checked={ticked[i]} onChange={() => setTicked((t) => t.map((v, j) => (j === i ? !v : v)))} />
            {item}
          </label>
        ))}
        <button className="btn btn-primary" disabled={busy || !ticked.every(Boolean)} onClick={onAsk} id={`ask-pickup-${orderId}`}>
          Finished, ask for a pickup
        </button>
      </div>
    )
  }

  const waiting = courier.status === 'BOOKING_REQUESTED'
  return (
    <div className="pickup-panel" id={`pickup-status-${orderId}`}>
      <strong>{waiting ? 'Waiting for a rider' : courier.status === 'RIDER_ASSIGNED' ? `${courier.riderName} is coming to collect` : 'The rider has your pages'}</strong>
      {courier.status !== 'PICKED_UP' && courier.pickupOtp && (
        <>
          <p className="pickup-help">When the rider arrives, read them this code. Do not hand over the pages until they have typed it in.</p>
          <div className="pickup-code" aria-label="Pickup code">{courier.pickupOtp}</div>
        </>
      )}
      {courier.riderPhone && courier.status === 'RIDER_ASSIGNED' && <p className="pickup-help">Rider phone: <a href={`tel:${courier.riderPhone}`}>{courier.riderPhone}</a></p>}
      {courier.trackingUrl && courier.status !== 'PICKED_UP' && <p className="pickup-help"><a href={courier.trackingUrl} target="_blank" rel="noreferrer">Track the rider</a></p>}
      {courier.status === 'PICKED_UP' && <p className="pickup-help">Your pages are on their way to the gate. You are paid 24 hours after delivery.</p>}
    </div>
  )
}
