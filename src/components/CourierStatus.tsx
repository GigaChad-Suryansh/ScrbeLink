/**
 * CourierStatus.tsx
 * What a customer sees about the rider: who is coming, and where to track them.
 */

import { useCourier } from '../lib/useCourier'

const TEXT: Record<string, string> = {
  BOOKING_REQUESTED: 'The pages are written. We are arranging a rider to collect them.',
  RIDER_ASSIGNED: 'A rider is on the way to collect your pages.',
  PICKED_UP: 'Your pages are with the rider and heading to your gate.',
  OUT_FOR_DELIVERY: 'Your pages are with the rider and heading to your gate.',
  DELIVERED_AT_GATE: 'Your pages were handed over at the gate.',
}

export default function CourierStatus({ orderId }: { orderId: string }) {
  const courier = useCourier(orderId, 'customer')
  if (!courier || !TEXT[courier.status]) return null
  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }} id="courier-card">
      <strong>Delivery</strong>
      <p style={{ margin: '6px 0 0', fontSize: 14 }}>{TEXT[courier.status]}</p>
      {courier.riderName && courier.status !== 'DELIVERED_AT_GATE' && (
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--muted)' }}>
          Rider: {courier.riderName}
          {courier.riderPhone && <> · <a href={`tel:${courier.riderPhone}`}>{courier.riderPhone}</a></>}
          {courier.trackingUrl && <> · <a href={courier.trackingUrl} target="_blank" rel="noreferrer">Track live</a></>}
        </p>
      )}
      {courier.status === 'PICKED_UP' && (
        <p style={{ margin: '8px 0 0', fontSize: 14 }}>
          At the gate, read your <strong>delivery code</strong> to the rider. Only give it when you are holding the pages.
        </p>
      )}
    </div>
  )
}
