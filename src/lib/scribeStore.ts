/**
 * scribeStore.ts
 * Types and context for the order list, scribe profile and wallet.
 * The data itself comes from the API (see portal.tsx).
 */

import { createContext, useContext } from 'react'

export type OrderStatus =
  | 'Draft' | 'Paid' | 'Accepted' | 'Writing' | 'Dispatched' | 'Delivered'
  | 'Disputed' | 'Reassigned' | 'Closed' | 'Cancelled'

export interface OrderTimelineEvent {
  status: OrderStatus
  timestamp: string
  note: string
}

export interface TrackableOrder {
  id: string
  title: string
  subject: string
  customerName: string // Anonymous identifier, e.g. "Customer #881"
  scribeId?: string
  scribeName?: string
  status: OrderStatus
  pages: number
  words: number
  addons: string[]
  penStyle: string
  customerPaid: number
  scribePayout: number
  createdAt: string
  deadlineAt: string
  intakeInspectionExpiresAt?: string // 30-min window after accept
  nextCheckInDueAt?: string // Hourly check-in timer during "Writing"
  timeline: OrderTimelineEvent[]
  /** Delivery code. Only the customer who owns the order receives it. */
  otp?: string
}

export interface ScribeProfile {
  id: string
  name: string
  phone: string
  upiVpa: string
  college: string
  specialties: string[]
  sampleText?: string
  sampleImageUrl?: string
  /** False until the person saves their profile for the first time. */
  registered: boolean
  isApproved: boolean
  isSuspended: boolean
  totalOrders: number
  walletBalance: number
  pendingEscrow: number
  lifetimeEarnings: number
}

export interface PayoutTransaction {
  id: string
  orderId: string
  amount: number
  status: 'In Escrow' | 'Released' | 'Transferred'
  date: string
}

/** Every action resolves to an error message, or null when it worked. */
export type ActionResult = Promise<string | null>

export interface ScribePortalContextType {
  /** Filled in for scribes; an empty placeholder (registered: false) for other roles. */
  profile: ScribeProfile
  orders: TrackableOrder[]
  payouts: PayoutTransaction[]
  loading: boolean
  /** Set when the last refresh failed. */
  loadError: string
  refresh: () => Promise<void>
  saveProfile: (p: { name: string; college: string; upiVpa: string; sampleText: string; specialties: string[]; sampleImageUrl?: string }) => ActionResult
  acceptOrder: (orderId: string) => ActionResult
  startWriting: (orderId: string) => ActionResult
  submitCheckIn: (orderId: string, note: string) => ActionResult
  dispatchOrder: (orderId: string) => ActionResult
  confirmDelivery: (orderId: string, code: string) => ActionResult
  withdraw: () => ActionResult
}

export const ScribePortalContext = createContext<ScribePortalContextType | null>(null)

export function useScribePortal(): ScribePortalContextType {
  const ctx = useContext(ScribePortalContext)
  if (!ctx) throw new Error('useScribePortal must be used inside <ScribePortalProvider>')
  return ctx
}

export const EMPTY_PROFILE: ScribeProfile = {
  id: '', name: '', phone: '', upiVpa: '', college: '', specialties: [], sampleText: '',
  sampleImageUrl: undefined, registered: false, isApproved: false, isSuspended: false, totalOrders: 0,
  walletBalance: 0, pendingEscrow: 0, lifetimeEarnings: 0,
}
