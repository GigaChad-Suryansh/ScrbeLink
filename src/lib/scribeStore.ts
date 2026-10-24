/**
 * scribeStore.ts
 * Shared state and mock data for Scribe Portal and Order Tracking.
 * State machine for orders: Paid -> Accepted -> Writing -> Dispatched -> Delivered
 */

import { createContext, useContext } from 'react'

export type OrderStatus = 'Paid' | 'Accepted' | 'Writing' | 'Dispatched' | 'Delivered'

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
  distanceKm: number
  createdAt: string
  deadlineAt: string
  intakeInspectionExpiresAt?: string // 30-min window after accept
  nextCheckInDueAt?: string // Hourly check-in timer during "Writing"
  timeline: OrderTimelineEvent[]
  proofUrl?: string
  otp?: string
}

export interface ScribeProfile {
  id: string
  name: string
  phone: string
  upiVpa: string
  college: string
  specialties: string[]
  sampleCardUrl?: string
  sampleText?: string
  isApproved: boolean
  rating: number
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
  upiVpa: string
}

export const INITIAL_ORDERS: TrackableOrder[] = [
  {
    id: 'SL-8921',
    title: 'Thermodynamics & Heat Transfer Notes',
    subject: 'Mechanical Engineering',
    customerName: 'Student #4092',
    status: 'Paid',
    pages: 14,
    words: 2780,
    addons: ['3 Complex Diagrams', 'College Template'],
    penStyle: 'Ballpoint · Blue',
    customerPaid: 486,
    scribePayout: 320,
    distanceKm: 1.2,
    createdAt: '10 mins ago',
    deadlineAt: 'Tomorrow, 6:00 PM',
    timeline: [
      { status: 'Paid', timestamp: '10 mins ago', note: 'Escrow payment confirmed. Scribe acceptance pending.' },
    ],
  },
  {
    id: 'SL-7412',
    title: 'Macroeconomics Unit 3: Monetary Policy',
    subject: 'Economics & Commerce',
    customerName: 'Student #9102',
    scribeId: 'S-2041',
    scribeName: 'Ananya R.',
    status: 'Writing',
    pages: 8,
    words: 1540,
    addons: ['2 Simple Diagrams'],
    penStyle: 'Gel · Black',
    customerPaid: 248,
    scribePayout: 165,
    distanceKm: 0.8,
    createdAt: '2 hours ago',
    deadlineAt: 'Today, 11:30 PM',
    intakeInspectionExpiresAt: 'Completed',
    nextCheckInDueAt: '28 mins remaining',
    timeline: [
      { status: 'Paid', timestamp: '2 hours ago', note: 'Escrow payment locked.' },
      { status: 'Accepted', timestamp: '1.8 hours ago', note: 'Scribe verified content within 30-min intake window.' },
      { status: 'Writing', timestamp: '1.5 hours ago', note: 'Transcription in progress. Check-in #1 submitted.' },
    ],
  },
  {
    id: 'SL-5830',
    title: 'Cell Biology & Genetics Lab Manual',
    subject: 'Biotechnology',
    customerName: 'Student #1833',
    scribeId: 'S-2041',
    scribeName: 'Ananya R.',
    status: 'Dispatched',
    pages: 22,
    words: 4400,
    addons: ['4 Complex Diagrams', 'Rigid Packaging'],
    penStyle: 'Ballpoint · Blue',
    customerPaid: 722,
    scribePayout: 485,
    distanceKm: 2.1,
    createdAt: 'Yesterday',
    deadlineAt: 'Today, 4:00 PM',
    otp: '4829',
    timeline: [
      { status: 'Paid', timestamp: 'Yesterday, 3:00 PM', note: 'Payment in escrow.' },
      { status: 'Accepted', timestamp: 'Yesterday, 3:20 PM', note: 'Intake approved.' },
      { status: 'Writing', timestamp: 'Yesterday, 4:00 PM', note: 'Writing completed with 4 hourly check-ins.' },
      { status: 'Dispatched', timestamp: 'Today, 2:30 PM', note: 'Borzo courier picked up envelope. OTP: 4829' },
    ],
  },
  {
    id: 'SL-3190',
    title: 'Linear Algebra & Vector Calculus',
    subject: 'Mathematics',
    customerName: 'Student #6281',
    scribeId: 'S-2041',
    scribeName: 'Ananya R.',
    status: 'Delivered',
    pages: 18,
    words: 3600,
    addons: ['Calibrated Graphs (×3)'],
    penStyle: 'Fountain · Black',
    customerPaid: 570,
    scribePayout: 381,
    distanceKm: 1.5,
    createdAt: '2 days ago',
    deadlineAt: 'Delivered',
    timeline: [
      { status: 'Paid', timestamp: '2 days ago', note: 'Payment confirmed.' },
      { status: 'Accepted', timestamp: '2 days ago', note: 'Accepted.' },
      { status: 'Writing', timestamp: 'Yesterday', note: 'Completed.' },
      { status: 'Dispatched', timestamp: 'Yesterday, 5:00 PM', note: 'Dispatched.' },
      { status: 'Delivered', timestamp: 'Yesterday, 6:15 PM', note: 'Gate drop photo verified. Escrow auto-release in 24h.' },
    ],
  },
]

export const INITIAL_SCRIBE_PROFILE: ScribeProfile = {
  id: 'S-2041',
  name: 'Ananya R.',
  phone: '+91 98765 43210',
  upiVpa: 'ananya.scribelink@okaxis',
  college: 'Delhi Technological University (DTU)',
  specialties: ['Engineering', 'Science & Math', 'Diagrams'],
  sampleText: "Newton's second law: F = ma. The acceleration of a body is directly proportional to the net force.",
  isApproved: true,
  rating: 4.9,
  totalOrders: 312,
  walletBalance: 2450,
  pendingEscrow: 650,
  lifetimeEarnings: 38400,
}

export const INITIAL_PAYOUTS: PayoutTransaction[] = [
  { id: 'TX-901', orderId: 'SL-3190', amount: 381, status: 'Released', date: 'Yesterday, 7:00 PM', upiVpa: 'ananya.scribelink@okaxis' },
  { id: 'TX-902', orderId: 'SL-5830', amount: 485, status: 'In Escrow', date: 'Today, 2:30 PM', upiVpa: 'ananya.scribelink@okaxis' },
  { id: 'TX-903', orderId: 'SL-7412', amount: 165, status: 'In Escrow', date: 'In Progress', upiVpa: 'ananya.scribelink@okaxis' },
  { id: 'TX-880', orderId: 'SL-2098', amount: 540, status: 'Transferred', date: '3 days ago', upiVpa: 'ananya.scribelink@okaxis' },
  { id: 'TX-879', orderId: 'SL-1922', amount: 320, status: 'Transferred', date: '5 days ago', upiVpa: 'ananya.scribelink@okaxis' },
]

export interface ScribePortalContextType {
  profile: ScribeProfile
  orders: TrackableOrder[]
  payouts: PayoutTransaction[]
  updateProfile: (profile: Partial<ScribeProfile>) => void
  acceptOrder: (orderId: string) => void
  advanceOrderStatus: (orderId: string, nextStatus: OrderStatus, note: string) => void
  submitCheckIn: (orderId: string) => void
  /** A customer's newly paid order joins the pool that scribes and the tracker read from. */
  addOrder: (order: TrackableOrder) => void
}

export const ScribePortalContext = createContext<ScribePortalContextType | null>(null)

export function useScribePortal(): ScribePortalContextType {
  const ctx = useContext(ScribePortalContext)
  if (!ctx) throw new Error('useScribePortal must be used inside <ScribePortalProvider>')
  return ctx
}
