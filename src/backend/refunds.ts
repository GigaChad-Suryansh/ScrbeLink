/**
 * backend/refunds.ts
 * The refund ledger. One refund per order, recorded in the same transaction that cancels the
 * order or settles the dispute, so an order can never end without its refund being written down.
 * In test mode a refund is marked processed at once; with a real gateway it starts PENDING
 * and the gateway's webhook marks it PROCESSED.
 */

import { refundAmount, type RefundReason } from '../shared/refunds'
import type { Queryable } from './db'

export interface RefundRecord {
  orderId: string
  paymentId: string
  amount: number
  reason: RefundReason
  status: 'PENDING' | 'PROCESSED'
  createdAt: string
}

const fromRow = (r: any): RefundRecord => ({
  orderId: r.order_id,
  paymentId: r.payment_id,
  amount: Number(r.amount),
  reason: r.reason,
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
})

/**
 * Writes the refund for an order if the customer actually paid and none exists yet.
 * Returns the refund, or undefined when there was nothing to refund.
 */
export async function recordRefund(
  q: Queryable,
  order: { id: string; customerTotal: number },
  reason: RefundReason,
  instant: boolean,
): Promise<RefundRecord | undefined> {
  const paid = await q.query(`SELECT payment_id FROM payments WHERE order_id = $1 AND intent->>'status' = 'SUCCESS' ORDER BY created_at DESC LIMIT 1`, [order.id])
  if (!paid.length) return undefined
  const amount = refundAmount(reason, order.customerTotal)
  const rows = await q.query(
    `INSERT INTO refunds (order_id, payment_id, amount, reason, status)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING RETURNING *`,
    [order.id, paid[0].payment_id, amount, reason, instant ? 'PROCESSED' : 'PENDING'],
  )
  return rows[0] ? fromRow(rows[0]) : undefined
}

export async function refundsFor(q: Queryable, orderIds: string[]): Promise<Map<string, RefundRecord>> {
  if (!orderIds.length) return new Map()
  const rows = await q.query('SELECT * FROM refunds WHERE order_id = ANY($1::text[])', [orderIds])
  return new Map(rows.map((r: any) => [r.order_id, fromRow(r)]))
}

export async function allRefunds(q: Queryable): Promise<RefundRecord[]> {
  return (await q.query('SELECT * FROM refunds ORDER BY created_at DESC')).map(fromRow)
}

export async function markProcessed(q: Queryable, orderId: string): Promise<boolean> {
  return (await q.query(`UPDATE refunds SET status = 'PROCESSED' WHERE order_id = $1 AND status = 'PENDING' RETURNING order_id`, [orderId])).length > 0
}

/**
 * Sends refunds that are still waiting to the payment gateway. Runs after the main jobs, outside
 * their transaction, so a slow gateway never holds the database. Razorpay then confirms by webhook.
 */
export async function sendPendingRefunds(
  q: Queryable,
  send: (razorpayPaymentId: string, amount: number, orderId: string) => Promise<{ id: string }>,
): Promise<{ sent: number; failed: number }> {
  const rows = await q.query(
    `SELECT r.order_id, r.amount, p.intent->>'rzpPaymentId' AS rzp_payment_id
     FROM refunds r JOIN payments p ON p.payment_id = r.payment_id
     WHERE r.status = 'PENDING' AND r.gateway_refund_id IS NULL`,
  )
  let sent = 0
  let failed = 0
  for (const r of rows) {
    if (!r.rzp_payment_id) { failed++; continue }
    try {
      const made = await send(r.rzp_payment_id, Number(r.amount), r.order_id)
      await q.query('UPDATE refunds SET gateway_refund_id = $2 WHERE order_id = $1', [r.order_id, made.id])
      sent++
    } catch {
      failed++ // stays PENDING and is tried again on the next run
    }
  }
  return { sent, failed }
}
