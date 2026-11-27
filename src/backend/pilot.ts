/**
 * backend/pilot.ts
 * Phase 20: pilot metrics and demo-data rules.
 *
 * Metrics come from each order's timeline, so they need no extra columns:
 *   time to accept  = first Accepted minus first Paid
 *   time to deliver = first Delivered minus first Paid
 *   dispute rate    = orders that were ever Disputed / orders that were paid
 *   rating          = average stars for orders paid in that week
 */

import type { Queryable } from './db'
import { isProduction } from './security'

/** Seeded sample scribes (seedDemoData). Never shown or seeded in production. */
export const DEMO_SCRIBE_IDS: ReadonlySet<string> = new Set(['S-2041', 'S-1887', 'S-9011'])

export const isDemoScribe = (id: string) => DEMO_SCRIBE_IDS.has(id)
export const showDemoScribes = () => !isProduction()

type Timeline = Array<{ status: string; timestamp: string }>

export interface PilotOrder {
  timeline: Timeline
  stars?: number | null
}

export interface PilotWeek {
  /** Monday of the week, YYYY-MM-DD (UTC). */
  week: string
  paidOrders: number
  /** Median minutes, or null when no order got there. */
  medianMinutesToAccept: number | null
  medianHoursToDeliver: number | null
  delivered: number
  disputed: number
  disputeRatePercent: number | null
  averageRating: number | null
  ratings: number
}

const firstAt = (t: Timeline, status: string): number | undefined => {
  const e = t.find((x) => x.status === status)
  return e ? Date.parse(e.timestamp) : undefined
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function weekStart(ms: number): string {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10)
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)

/** Groups paid orders by the week they were paid and summarises each week, newest first. */
export function computePilotMetrics(orders: PilotOrder[]): PilotWeek[] {
  const weeks = new Map<string, PilotOrder[]>()
  for (const o of orders) {
    const paid = firstAt(o.timeline, 'Paid')
    if (paid === undefined) continue
    const k = weekStart(paid)
    weeks.set(k, [...(weeks.get(k) ?? []), o])
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([week, list]) => {
      const accept: number[] = []
      const deliver: number[] = []
      let disputed = 0
      const stars: number[] = []
      for (const o of list) {
        const paid = firstAt(o.timeline, 'Paid')!
        const acc = firstAt(o.timeline, 'Accepted')
        const del = firstAt(o.timeline, 'Delivered')
        if (acc !== undefined) accept.push((acc - paid) / 60_000)
        if (del !== undefined) deliver.push((del - paid) / 3_600_000)
        if (o.timeline.some((x) => x.status === 'Disputed')) disputed++
        if (typeof o.stars === 'number') stars.push(o.stars)
      }
      return {
        week,
        paidOrders: list.length,
        medianMinutesToAccept: round1(median(accept)),
        medianHoursToDeliver: round1(median(deliver)),
        delivered: deliver.length,
        disputed,
        disputeRatePercent: round1((disputed / list.length) * 100),
        averageRating: round1(stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null),
        ratings: stars.length,
      }
    })
}

/** Pilot metrics for the last `weeks` weeks. */
export async function getPilotMetrics(q: Queryable, weeks = 8): Promise<PilotWeek[]> {
  const rows = await q.query<{ timeline: Timeline; stars: number | null }>(
    `SELECT o.timeline, r.stars FROM orders o LEFT JOIN ratings r ON r.order_id = o.id
     WHERE o.status <> 'Draft' AND o.created_at >= now() - ($1::int * interval '7 days')`,
    [weeks + 1],
  )
  return computePilotMetrics(rows).slice(0, weeks)
}
