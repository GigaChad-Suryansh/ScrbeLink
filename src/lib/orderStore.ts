/**
 * orderStore.ts
 * Lightweight shared order state implemented with a module-level singleton +
 * React context.  Intentionally avoids external state libraries so Phase 2
 * stays dependency-light.
 */

import { createContext, useContext } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type PenType = 'ballpoint' | 'gel' | 'fountain'
export type InkColor = 'blue' | 'black'

export interface UploadedDoc {
  name: string
  sizeBytes: number
  wordCount: number
  hasCoverPageWarning: boolean
}

export interface ScribeMock {
  id: string
  name: string
  tag: string         // e.g. "S-2041"
  rating: number      // 1-5
  ordersCompleted: number
  sample: string      // handwriting sample text (rendered in Caveat font)
  specialty: string   // e.g. "Science & Math"
  available: boolean
}

export interface OrderState {
  // Step 1 - Upload
  doc: UploadedDoc | null
  words: number

  // Step 2 - Add-ons & pen/ink
  simpleDrawings: number
  complexDrawings: number
  graphs: number
  customTemplate: boolean
  pen: PenType
  ink: InkColor

  // Step 3 - Scribe picker
  scribeId: string | null

  // Step 4 - Checkout (mock)
  upiId: string
  orderId: string | null   // set after "payment"
}

export type OrderAction =
  | { type: 'SET_DOC'; doc: UploadedDoc; words: number }
  | { type: 'SET_ADDONS'; simpleDrawings: number; complexDrawings: number; graphs: number; customTemplate: boolean }
  | { type: 'SET_PEN'; pen: PenType; ink: InkColor }
  | { type: 'SET_SCRIBE'; scribeId: string }
  | { type: 'SET_UPI'; upiId: string }
  | { type: 'PLACE_ORDER'; orderId: string }
  | { type: 'RESET' }

export const INITIAL_ORDER: OrderState = {
  doc: null,
  words: 0,
  simpleDrawings: 0,
  complexDrawings: 0,
  graphs: 0,
  customTemplate: false,
  pen: 'ballpoint',
  ink: 'blue',
  scribeId: null,
  upiId: '',
  orderId: null,
}

export function orderReducer(state: OrderState, action: OrderAction): OrderState {
  switch (action.type) {
    case 'SET_DOC':
      return { ...state, doc: action.doc, words: action.words }
    case 'SET_ADDONS':
      return {
        ...state,
        simpleDrawings: action.simpleDrawings,
        complexDrawings: action.complexDrawings,
        graphs: action.graphs,
        customTemplate: action.customTemplate,
      }
    case 'SET_PEN':
      return { ...state, pen: action.pen, ink: action.ink }
    case 'SET_SCRIBE':
      return { ...state, scribeId: action.scribeId }
    case 'SET_UPI':
      return { ...state, upiId: action.upiId }
    case 'PLACE_ORDER':
      return { ...state, orderId: action.orderId }
    case 'RESET':
      return { ...INITIAL_ORDER }
    default:
      return state
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

export interface OrderContextValue {
  state: OrderState
  dispatch: React.Dispatch<OrderAction>
}

export const OrderContext = createContext<OrderContextValue | null>(null)

export function useOrder(): OrderContextValue {
  const ctx = useContext(OrderContext)
  if (!ctx) throw new Error('useOrder must be used inside <OrderProvider>')
  return ctx
}

// ── Mock scribes ─────────────────────────────────────────────────────────────

export const MOCK_SCRIBES: ScribeMock[] = [
  {
    id: 'S-2041',
    name: 'Ananya R.',
    tag: 'S-2041',
    rating: 4.9,
    ordersCompleted: 312,
    sample: "Newton's second law: F = ma. The acceleration of a body is directly proportional to the net force.",
    specialty: 'Science & Math',
    available: true,
  },
  {
    id: 'S-1887',
    name: 'Rohan M.',
    tag: 'S-1887',
    rating: 4.8,
    ordersCompleted: 208,
    sample: "The French Revolution began in 1789 with the storming of the Bastille, marking the end of the Ancien Regime.",
    specialty: 'Humanities',
    available: true,
  },
  {
    id: 'S-3104',
    name: 'Priya S.',
    tag: 'S-3104',
    rating: 4.7,
    ordersCompleted: 155,
    sample: "Ohm's Law: V = IR. Kirchhoff's current law states the sum of currents entering a node equals the sum leaving.",
    specialty: 'Engineering',
    available: true,
  },
  {
    id: 'S-0992',
    name: 'Dev K.',
    tag: 'S-0992',
    rating: 4.6,
    ordersCompleted: 97,
    sample: 'Cell theory: all living organisms are composed of cells, the basic unit of life, arising from pre-existing cells.',
    specialty: 'Life Sciences',
    available: false,
  },
]
