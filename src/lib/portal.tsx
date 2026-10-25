/**
 * lib/portal.tsx
 * Loads orders (and, for scribes, the profile and wallet) from the API for one role,
 * keeps them fresh, and turns user actions into API calls.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, api, type Role } from './api'
import {
  ScribePortalContext,
  EMPTY_PROFILE,
  type PayoutTransaction,
  type ScribeProfile,
  type TrackableOrder,
  type ScribePortalContextType,
  type OrderStatus,
} from './scribeStore'

interface ApiOrder {
  id: string
  title: string
  subject: string
  status: OrderStatus
  customerTotal: number
  scribePayout: number
  scribeId?: string
  scribeName?: string
  pages: number
  words: number
  addons: string[]
  penStyle: string
  deliveryOtp?: string
  createdAt: string
  intakeDeadline?: string
  nextCheckInDue?: string
  finalDeadline: string
  timeline: Array<{ status: string; timestamp: string; note: string }>
}

const when = (ts: string) => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

/** "42 min left", "overdue", or undefined when there is no timer. */
function remaining(iso?: string): string | undefined {
  if (!iso) return undefined
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return undefined
  if (ms <= 0) return 'overdue'
  const m = Math.ceil(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`
}

function toTrackable(o: ApiOrder): TrackableOrder {
  return {
    id: o.id,
    title: o.title,
    subject: o.subject,
    customerName: 'Anonymous student',
    scribeId: o.scribeId,
    scribeName: o.scribeName,
    status: o.status,
    pages: o.pages,
    words: o.words,
    addons: o.addons ?? [],
    penStyle: o.penStyle ?? '',
    customerPaid: o.customerTotal,
    scribePayout: o.scribePayout,
    createdAt: when(o.createdAt),
    deadlineAt: o.finalDeadline,
    intakeInspectionExpiresAt: o.status === 'Accepted' ? remaining(o.intakeDeadline) : undefined,
    nextCheckInDueAt: o.status === 'Writing' ? remaining(o.nextCheckInDue) : undefined,
    timeline: o.timeline.map((t) => ({ status: t.status as OrderStatus, timestamp: when(t.timestamp), note: t.note })),
    otp: o.deliveryOtp,
  }
}

interface ScribeMe {
  profile: Omit<ScribeProfile, 'walletBalance' | 'pendingEscrow' | 'lifetimeEarnings' | 'phone'> & { phone: string }
  walletBalance: number
  pendingEscrow: number
  lifetimeEarnings: number
  payouts: PayoutTransaction[]
}

const POLL_MS = 6000

export function PortalProvider({ role, children }: { role: Role; children: ReactNode }) {
  const [orders, setOrders] = useState<TrackableOrder[]>([])
  const [profile, setProfile] = useState<ScribeProfile>(EMPTY_PROFILE)
  const [payouts, setPayouts] = useState<PayoutTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const alive = useRef(true)

  const applyMe = useCallback((me: ScribeMe) => {
    setProfile({ ...me.profile, walletBalance: me.walletBalance, pendingEscrow: me.pendingEscrow, lifetimeEarnings: me.lifetimeEarnings })
    setPayouts(me.payouts)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await api<{ orders: ApiOrder[] }>('GET', '/api/orders', { as: role })
      if (!alive.current) return
      setOrders(list.orders.map(toTrackable))
      if (role === 'scribe') applyMe(await api<ScribeMe>('GET', '/api/scribe/me', { as: 'scribe' }))
      if (alive.current) setLoadError('')
    } catch (e) {
      if (alive.current) setLoadError((e as Error).message)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [role, applyMe])

  useEffect(() => {
    alive.current = true
    // oxlint-disable-next-line react/set-state-in-effect -- loads data from the API on mount; state is set after the request resolves
    void refresh()
    const id = setInterval(() => { if (!document.hidden) void refresh() }, POLL_MS)
    return () => { alive.current = false; clearInterval(id) }
  }, [refresh])

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<string | null> => {
      try {
        await fn()
        await refresh()
        return null
      } catch (e) {
        return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'
      }
    },
    [refresh],
  )

  const value = useMemo<ScribePortalContextType>(() => {
    const move = (orderId: string, nextStatus: string, note?: string) =>
      api('POST', `/api/orders/${orderId}/transition`, { as: role, body: { nextStatus, note } })
    return {
      profile,
      orders,
      payouts,
      loading,
      loadError,
      refresh,
      saveProfile: (p) =>
        run(async () => applyMe(await api<ScribeMe>('PUT', '/api/scribe/me', { as: 'scribe', body: p }))),
      acceptOrder: (id) => run(() => move(id, 'Accepted', 'Accepted. 30-minute intake window started.')),
      startWriting: (id) => run(() => move(id, 'Writing', '30-minute intake inspection passed. Writing started.')),
      submitCheckIn: (id, note) => run(() => api('POST', `/api/orders/${id}/checkin`, { as: role, body: { note: note || undefined } })),
      dispatchOrder: (id) => run(() => api('POST', '/api/logistics/dispatch', { as: role, body: { orderId: id } })),
      confirmDelivery: (id, code) => run(() => api('POST', '/api/logistics/confirm-delivery', { as: role, body: { orderId: id, deliveryOtp: code } })),
      withdraw: () => run(async () => applyMe(await api<ScribeMe>('POST', '/api/scribe/withdraw', { as: 'scribe' }))),
    }
  }, [profile, orders, payouts, loading, loadError, refresh, run, role, applyMe])

  return <ScribePortalContext.Provider value={value}>{children}</ScribePortalContext.Provider>
}
