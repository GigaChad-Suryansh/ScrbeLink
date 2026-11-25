import type { ReactNode } from 'react'
import { useCourier, isManualCourier } from '../lib/useCourier'

/** Shows the scribe-enters-the-code controls only for the demo courier. With a real rider the rider types the codes. */
export default function CourierGate({ orderId, children }: { orderId: string; children: ReactNode }) {
  const courier = useCourier(orderId, 'scribe')
  if (courier === undefined || isManualCourier(courier)) return null
  return <>{children}</>
}
