/**
 * shared/refunds.ts
 * When a customer gets money back, and how much. Used by the API and shown to customers.
 */

export type RefundReason =
  | 'CUSTOMER_CANCELLED'
  | 'NO_SCRIBE'
  | 'ADMIN_CANCELLED'
  | 'DISPUTE_UPHELD'
  | 'DISPUTE_SPLIT'

export const REFUND_POLICY = {
  /** A paid order nobody has taken for this long is cancelled and refunded in full. */
  unacceptedHours: 6,
  /** Share of the total returned when a dispute is split. */
  splitShare: 0.5,
} as const

/** A customer can cancel until the scribe starts writing. After that, the scribe's time is spent. */
export const CUSTOMER_CANCEL_STATES = ['Draft', 'Paid', 'Accepted'] as const

export const customerCanCancel = (status: string): boolean => (CUSTOMER_CANCEL_STATES as readonly string[]).includes(status)

export function refundAmount(reason: RefundReason, total: number): number {
  const share = reason === 'DISPUTE_SPLIT' ? REFUND_POLICY.splitShare : 1
  return Math.round(total * share * 100) / 100
}

export const REFUND_REASON_TEXT: Record<RefundReason, string> = {
  CUSTOMER_CANCELLED: 'You cancelled the order',
  NO_SCRIBE: `No scribe accepted the order within ${REFUND_POLICY.unacceptedHours} hours`,
  ADMIN_CANCELLED: 'Cancelled by ScribeLink support',
  DISPUTE_UPHELD: 'Your dispute was upheld',
  DISPUTE_SPLIT: 'Your dispute was settled with a partial refund',
}

export const CANCELLATION_POLICY = [
  'Cancel any time before the scribe starts writing and you get the full amount back.',
  `If no scribe accepts within ${REFUND_POLICY.unacceptedHours} hours, we cancel and refund you in full.`,
  'Once writing has started you cannot cancel. If the delivered notes are wrong, open a dispute within 24 hours.',
  'Refunds go back to the UPI ID you paid from, usually within 5 to 7 working days.',
]
