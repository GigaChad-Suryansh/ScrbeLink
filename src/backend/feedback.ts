/**
 * feedback.ts
 * Scribe ratings (one per order, after delivery) and support tickets.
 */

import type { Queryable } from './db'
import { randomToken } from '../shared/random'

export const LOW_RATING_AVERAGE = 3.5
export const LOW_RATING_MIN_COUNT = 5

/** Returns false when the order was already rated. */
export async function addRating(q: Queryable, orderId: string, scribeId: string, stars: number, comment: string): Promise<boolean> {
  const r = await q.query<{ order_id: string }>(
    'INSERT INTO ratings (order_id, scribe_id, stars, comment) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING RETURNING order_id',
    [orderId, scribeId, stars, comment])
  return r.length > 0
}

export async function ratingOf(q: Queryable, orderId: string): Promise<{ stars: number; comment: string } | null> {
  const r = await q.query<{ stars: number; comment: string }>('SELECT stars, comment FROM ratings WHERE order_id = $1', [orderId])
  return r[0] ?? null
}

export async function scribeSummary(q: Queryable, scribeId: string): Promise<{ average: number | null; count: number }> {
  const r = await q.query<{ avg: string | null; n: string }>('SELECT avg(stars) AS avg, count(*) AS n FROM ratings WHERE scribe_id = $1', [scribeId])
  const count = Number(r[0]?.n ?? 0)
  return { average: count > 0 ? Math.round(Number(r[0]!.avg) * 10) / 10 : null, count }
}

/** Scribes whose average is low once there are enough ratings to mean something. For the admin. */
export async function lowRatedScribes(q: Queryable): Promise<{ scribeId: string; average: number; count: number }[]> {
  const r = await q.query<{ scribe_id: string; avg: string; n: string }>(
    'SELECT scribe_id, avg(stars) AS avg, count(*) AS n FROM ratings GROUP BY scribe_id HAVING count(*) >= $1 AND avg(stars) < $2 ORDER BY avg(stars)',
    [LOW_RATING_MIN_COUNT, LOW_RATING_AVERAGE])
  return r.map((x) => ({ scribeId: x.scribe_id, average: Math.round(Number(x.avg) * 10) / 10, count: Number(x.n) }))
}

export interface Ticket { id: string; orderId: string | null; phone: string; subject: string; body: string; status: string; reply: string; createdAt: string }
const toTicket = (r: Record<string, unknown>): Ticket => ({
  id: r.id as string, orderId: (r.order_id as string | null) ?? null, phone: r.phone as string, subject: r.subject as string,
  body: r.body as string, status: r.status as string, reply: r.reply as string, createdAt: new Date(r.created_at as string).toISOString(),
})

export async function openTicket(q: Queryable, phone: string, orderId: string | null, subject: string, body: string): Promise<Ticket> {
  const id = `TKT-${randomToken(4).toUpperCase()}`
  const r = await q.query('INSERT INTO tickets (id, order_id, phone, subject, body) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, orderId, phone, subject, body])
  return toTicket(r[0])
}
export const ticketsFor = async (q: Queryable, phone: string) =>
  (await q.query('SELECT * FROM tickets WHERE phone = $1 ORDER BY created_at DESC LIMIT 50', [phone])).map(toTicket)
export const allTickets = async (q: Queryable) =>
  (await q.query(`SELECT * FROM tickets ORDER BY (status = 'OPEN') DESC, created_at DESC LIMIT 100`)).map(toTicket)
export async function closeTicket(q: Queryable, id: string, reply: string): Promise<Ticket | null> {
  const r = await q.query(`UPDATE tickets SET status = 'CLOSED', reply = $2 WHERE id = $1 RETURNING *`, [id, reply])
  return r[0] ? toTicket(r[0]) : null
}
