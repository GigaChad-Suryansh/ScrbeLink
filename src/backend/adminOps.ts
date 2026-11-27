/**
 * backend/adminOps.ts
 * Phase 17: Admin dashboard stats, order/phone/scribe search,
 * audit log retrieval, and accounts CSV export.
 */

import type { Queryable } from './db'

export interface AdminDashboardStats {
  ordersToday: number
  lateOrders: number
  openDisputes: number
  pendingScribes: number
  moneyInEscrow: number
}

export async function getAdminDashboardStats(q: Queryable): Promise<AdminDashboardStats> {
  const [today, late, disputes, scribes, escrow] = await Promise.all([
    q.query<{ n: string }>(`SELECT count(*) AS n FROM orders WHERE created_at >= date_trunc('day', now())`),
    q.query<{ n: string }>(
      `SELECT count(*) AS n FROM orders
       WHERE status IN ('Accepted', 'Writing', 'Dispatched')
         AND ((intake_deadline IS NOT NULL AND intake_deadline < now())
           OR (next_check_in_due IS NOT NULL AND next_check_in_due < now()))`,
    ),
    q.query<{ n: string }>(`SELECT count(*) AS n FROM disputes WHERE status = 'PENDING_REVIEW'`),
    q.query<{ n: string }>(`SELECT count(*) AS n FROM scribes WHERE NOT is_approved`),
    q.query<{ total: string }>(`SELECT COALESCE(sum(amount), 0) AS total FROM escrow WHERE NOT is_released`),
  ])

  return {
    ordersToday: Number(today[0]?.n ?? 0),
    lateOrders: Number(late[0]?.n ?? 0),
    openDisputes: Number(disputes[0]?.n ?? 0),
    pendingScribes: Number(scribes[0]?.n ?? 0),
    moneyInEscrow: Number(escrow[0]?.total ?? 0),
  }
}

export interface AdminOrderSearchRow {
  id: string
  title: string
  subject: string
  status: string
  customerPhone: string | null
  scribeId: string | null
  scribeName: string | null
  pages: number
  customerTotal: number
  scribePayout: number
  timeline: Array<{ status: string; timestamp: string; note: string }>
  createdAt: string
}

export async function searchAdminOrders(q: Queryable, rawQuery: string): Promise<AdminOrderSearchRow[]> {
  const term = rawQuery.trim()
  const rows = term
    ? await q.query<Record<string, unknown>>(
        `SELECT id, title, subject, status, customer_phone, scribe_id, scribe_name,
                pages, customer_total, scribe_payout, timeline, created_at
         FROM orders
         WHERE id ILIKE $1
            OR COALESCE(customer_phone, '') ILIKE $1
            OR COALESCE(scribe_id, '') ILIKE $1
            OR COALESCE(scribe_name, '') ILIKE $1
            OR title ILIKE $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [`%${term}%`],
      )
    : await q.query<Record<string, unknown>>(
        `SELECT id, title, subject, status, customer_phone, scribe_id, scribe_name,
                pages, customer_total, scribe_payout, timeline, created_at
         FROM orders
         ORDER BY created_at DESC
         LIMIT 50`,
      )

  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    subject: r.subject as string,
    status: r.status as string,
    customerPhone: (r.customer_phone as string | null) ?? null,
    scribeId: (r.scribe_id as string | null) ?? null,
    scribeName: (r.scribe_name as string | null) ?? null,
    pages: Number(r.pages),
    customerTotal: Number(r.customer_total),
    scribePayout: Number(r.scribe_payout),
    timeline: Array.isArray(r.timeline) ? (r.timeline as AdminOrderSearchRow['timeline']) : [],
    createdAt: new Date(r.created_at as string).toISOString(),
  }))
}

export interface AuditLogEntry {
  id: number
  at: string
  entry: string
}

export async function getAuditLog(q: Queryable, limit = 100): Promise<AuditLogEntry[]> {
  const rows = await q.query<{ id: string; at: string; entry: string }>(
    'SELECT id, at, entry FROM audit_log ORDER BY id DESC LIMIT $1',
    [limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.at).toISOString(),
    entry: r.entry,
  }))
}

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function buildAccountsCsv(q: Queryable): Promise<string> {
  const rows = await q.query<Record<string, unknown>>(
    `SELECT o.id, o.created_at, o.status, o.customer_phone, o.scribe_id, o.pages,
            o.customer_total, o.scribe_payout,
            COALESCE(r.amount, 0) AS refund_amount,
            COALESCE(r.status, '') AS refund_status
     FROM orders o
     LEFT JOIN refunds r ON r.order_id = o.id
     ORDER BY o.created_at DESC`,
  )

  const header = [
    'order_id',
    'created_at',
    'status',
    'customer_phone',
    'scribe_id',
    'pages',
    'customer_total_inr',
    'scribe_payout_inr',
    'platform_margin_inr',
    'refund_amount_inr',
    'refund_status',
  ].join(',')

  const lines = rows.map((r) => {
    const total = Number(r.customer_total)
    const payout = Number(r.scribe_payout)
    const margin = Math.round((total - payout) * 100) / 100
    return [
      r.id,
      new Date(r.created_at as string).toISOString(),
      r.status,
      r.customer_phone ?? '',
      r.scribe_id ?? '',
      r.pages,
      total.toFixed(2),
      payout.toFixed(2),
      margin.toFixed(2),
      Number(r.refund_amount).toFixed(2),
      r.refund_status ?? '',
    ]
      .map(csvCell)
      .join(',')
  })

  return [header, ...lines].join('\r\n')
}

