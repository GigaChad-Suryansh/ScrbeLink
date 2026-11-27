/**
 * components/AdminPilot.tsx
 * Phase 20: weekly pilot metrics. Time to accept, time to deliver, dispute rate and rating.
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface PilotWeek {
  week: string
  paidOrders: number
  medianMinutesToAccept: number | null
  medianHoursToDeliver: number | null
  delivered: number
  disputed: number
  disputeRatePercent: number | null
  averageRating: number | null
  ratings: number
}

const dash = (v: number | null, unit = '') => (v === null ? '-' : `${v}${unit}`)

export default function AdminPilot() {
  const [weeks, setWeeks] = useState<PilotWeek[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ weeks: PilotWeek[] }>('GET', '/api/admin/pilot-metrics?weeks=8', { as: 'admin' })
      .then((r) => setWeeks(r.weeks))
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="admin-card-section">
      <h2>Pilot metrics</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
        Paid orders grouped by the week they were paid (Monday start). Times are medians from payment.
        Fix the top three problems here before opening a second campus.
      </p>
      {error && <div className="alert alert--warn" role="alert">{error}</div>}
      {weeks && weeks.length === 0 && <div className="card empty-state" style={{ marginTop: 16 }}><p>No paid orders yet.</p></div>}
      {weeks && weeks.length > 0 && (
        <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: 8 }}>Week of</th>
                <th style={{ padding: 8 }}>Paid</th>
                <th style={{ padding: 8 }}>Time to accept</th>
                <th style={{ padding: 8 }}>Time to deliver</th>
                <th style={{ padding: 8 }}>Disputes</th>
                <th style={{ padding: 8 }}>Rating</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: 8 }}>{w.week}</td>
                  <td style={{ padding: 8 }}>{w.paidOrders}</td>
                  <td style={{ padding: 8 }}>{dash(w.medianMinutesToAccept, ' min')}</td>
                  <td style={{ padding: 8 }}>{dash(w.medianHoursToDeliver, ' h')} <span style={{ color: 'var(--muted)' }}>({w.delivered} delivered)</span></td>
                  <td style={{ padding: 8 }}>{w.disputed} <span style={{ color: 'var(--muted)' }}>({dash(w.disputeRatePercent, '%')})</span></td>
                  <td style={{ padding: 8 }}>{dash(w.averageRating)} <span style={{ color: 'var(--muted)' }}>({w.ratings})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
