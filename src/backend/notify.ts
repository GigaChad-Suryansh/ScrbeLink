/**
 * notify.ts
 * Order event messages. Each event is sent once per person: the dedupe key makes a repeat a no-op,
 * so a retried request or a second cron run cannot message anyone twice.
 * Messages go to the log today; a WhatsApp/SMS provider plugs in at `deliver`.
 */

import type { Queryable } from './db'
import { randomToken } from '../shared/random'

export interface OrderEvent {
  id: string
  status: string
  customerPhone?: string
  scribeId?: string
  scribeName?: string
}

interface Msg { to: 'customer' | 'scribe'; template: string; text: string }

/** What to say, and to whom, when an order reaches a status. */
export function messagesFor(order: OrderEvent, next: string): Msg[] {
  const id = order.id
  switch (next) {
    case 'Paid': return [{ to: 'customer', template: 'ORDER_PAID', text: `ScribeLink: payment received for order ${id}. We are finding your scribe.` }]
    case 'Accepted': return [{ to: 'customer', template: 'SCRIBE_ACCEPTED', text: `ScribeLink: ${order.scribeName ?? 'A scribe'} accepted order ${id}.` }]
    case 'Writing': return [{ to: 'customer', template: 'WRITING_STARTED', text: `ScribeLink: writing has started on order ${id}.` }]
    case 'Delivered': return [
      { to: 'customer', template: 'DELIVERED', text: `ScribeLink: order ${id} was delivered. You have 24 hours to report a problem.` },
      { to: 'scribe', template: 'SCRIBE_DELIVERED', text: `ScribeLink: order ${id} was delivered. You are paid 24 hours after delivery.` },
    ]
    case 'Disputed': return [
      { to: 'customer', template: 'DISPUTE_OPENED', text: `ScribeLink: your report on order ${id} is with our team.` },
      { to: 'scribe', template: 'SCRIBE_DISPUTE_OPENED', text: `ScribeLink: order ${id} has been reported. Your payment is on hold.` },
    ]
    case 'Closed': return [{ to: 'scribe', template: 'PAYOUT_RELEASED', text: `ScribeLink: order ${id} is closed and your payment is in your wallet.` }]
    case 'Cancelled': return [{ to: 'customer', template: 'ORDER_CANCELLED', text: `ScribeLink: order ${id} was cancelled. Any refund is on its way.` }]
    default: return []
  }
}

/** Stores one message. Returns false when this exact message was already sent. */
export async function notifyOnce(q: Queryable, key: string, recipient: string, template: string, content: string): Promise<boolean> {
  const record = { id: `NOTIF-${Date.now()}-${randomToken(2)}`, channel: 'WHATSAPP', recipient, templateName: template, content, sentAt: new Date().toLocaleTimeString(), status: 'DELIVERED' }
  const rows = await q.query<{ id: string }>(
    `INSERT INTO notifications (record, recipient, dedupe_key) VALUES ($1::jsonb, $2, $3) ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
    [JSON.stringify(record), recipient, key],
  )
  return rows.length > 0
}

export async function notifyOrderEvent(q: Queryable, order: OrderEvent, next: string): Promise<void> {
  const msgs = messagesFor(order, next)
  if (msgs.length === 0) return
  let scribePhone: string | undefined
  if (order.scribeId && msgs.some((m) => m.to === 'scribe')) {
    const r = await q.query<{ phone: string | null }>('SELECT phone FROM scribes WHERE scribe_id = $1', [order.scribeId])
    scribePhone = r[0]?.phone ?? undefined
  }
  for (const m of msgs) {
    const to = m.to === 'customer' ? order.customerPhone : scribePhone
    if (to) await notifyOnce(q, `${order.id}:${m.template}:${to}`, to, m.template, m.text)
  }
}

export interface InboxItem { id: string; template: string; content: string; at: string; read: boolean }

export async function inbox(q: Queryable, phone: string): Promise<{ items: InboxItem[]; unread: number }> {
  const rows = await q.query<{ id: string; record: { templateName: string; content: string }; created_at: string; read_at: string | null }>(
    'SELECT id, record, created_at, read_at FROM notifications WHERE recipient = $1 ORDER BY id DESC LIMIT 30', [phone])
  const items = rows.map((r) => ({ id: String(r.id), template: r.record.templateName, content: r.record.content, at: new Date(r.created_at).toISOString(), read: r.read_at !== null }))
  return { items, unread: items.filter((i) => !i.read).length }
}

export async function markAllRead(q: Queryable, phone: string): Promise<void> {
  await q.query('UPDATE notifications SET read_at = now() WHERE recipient = $1 AND read_at IS NULL', [phone])
}
