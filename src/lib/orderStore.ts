/**
 * orderStore.ts
 * Lightweight shared order state implemented with a module-level singleton +
 * React context for the order being built in the wizard.
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
  /** Null means any approved scribe. */
  scribeId: string | null
  scribeName: string | null

  // Step 4 - Checkout
  upiId: string
  orderId: string | null   // set after "payment"
}

export type OrderAction =
  | { type: 'SET_DOC'; doc: UploadedDoc; words: number }
  | { type: 'SET_ADDONS'; simpleDrawings: number; complexDrawings: number; graphs: number; customTemplate: boolean }
  | { type: 'SET_PEN'; pen: PenType; ink: InkColor }
  | { type: 'SET_SCRIBE'; scribeId: string | null; scribeName: string | null }
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
  scribeName: null,
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
      return { ...state, scribeId: action.scribeId, scribeName: action.scribeName }
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
