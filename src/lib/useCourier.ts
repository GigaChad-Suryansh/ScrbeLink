import { useEffect, useState } from 'react'
import { api, type Role } from './api'

export interface CourierInfo {
  status: 'BOOKING_REQUESTED' | 'RIDER_ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'ASSIGNED' | 'DELIVERED_AT_GATE' | 'FAILED'
  pickupOtp?: string
  riderName?: string
  riderPhone?: string
  trackingUrl?: string
  attempts?: number
  pickedUpAt?: string
  deliveredAt?: string
}

/** Courier details for one order, refreshed every few seconds while the page is open. */
export function useCourier(orderId: string, as: Role): CourierInfo | null | undefined {
  const [courier, setCourier] = useState<CourierInfo | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const load = () =>
      api<{ courier: CourierInfo | null }>('GET', `/api/orders/${orderId}/courier`, { as })
        .then((r) => live && setCourier(r.courier))
        .catch(() => undefined)
    load()
    const t = setInterval(load, 6000)
    return () => { live = false; clearInterval(t) }
  }, [orderId, as])
  return courier
}

/** The manual flow is in use when a rider is being arranged. The old demo flow uses OUT_FOR_DELIVERY. */
export const isManualCourier = (c: CourierInfo | null | undefined) => !!c && ['BOOKING_REQUESTED', 'RIDER_ASSIGNED', 'PICKED_UP'].includes(c.status)
