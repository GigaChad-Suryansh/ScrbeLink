/**
 * components/AdminOrdersOps.tsx
 * Phase 17: Order search (by order ID, phone, or scribe), timeline viewer,
 * manual reassign/refund tools, audit log, and accounts CSV export.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, getSession } from '../lib/api'
import { inr } from '../lib/pricing'

interface AdminOrderRow {
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

interface AuditEntry {
  id: number
  at: string
  entry: string
}

export default function AdminOrdersOps({ onChanged }: { onChanged?: () => void }) {
  const [query, setQuery] = useState('')
  const [orders, setOrders] = useState<AdminOrderRow[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadOrders = useCallback(async (q: string) => {
    try {
      const [o, a] = await Promise.all([
        api<{ orders: AdminOrderRow[] }>('GET', `/api/admin/orders?q=${encodeURIComponent(q)}`, { as: 'admin' }),
        api<{ entries: AuditEntry[] }>('GET', '/api/admin/audit-log', { as: 'admin' }),
      ])
      setOrders(o.orders)
      setAudit(a.entries)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads initial data from API on mount
    void loadOrders('')
  }, [loadOrders])

  async function runAction(path: string, body: unknown, doneMsg: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api('POST', path, { as: 'admin', body })
      setNotice(doneMsg)
      setReason('')
      await loadOrders(query)
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function downloadCsv() {
    setError('')
    try {
      const session = getSession('admin')
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
      const res = await fetch(`${base}/api/admin/export/accounts.csv`, {
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      })
      if (!res.ok) throw new Error('Could not export CSV')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'scribelink-accounts.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const selected = orders.find((o) => o.id === selectedId) ?? null

  return (
    <div className="admin-ops-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>Orders, Search &amp; Manual Tools</h2>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
            Search by order ID, customer phone, or scribe. Inspect full timelines, reassign stuck orders, or issue refunds.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={downloadCsv}>
          Export accounts CSV
        </button>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void loadOrders(query) }}
        style={{ display: 'flex', gap: 8, marginTop: 16, maxWidth: 520 }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search order ID (SL-...), phone (+91...), or scribe..."
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary">Search</button>
      </form>

      {error && <div className="alert alert--warn" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      {notice && <div className="alert alert--ok" role="status" style={{ marginTop: 12 }}>{notice}</div>}

      <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
        <table className="payout-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Status</th>
              <th>Customer</th>
              <th>Scribe</th>
              <th>Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No matching orders.</td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>#{o.id}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{o.title} · {o.pages}p</div>
                </td>
                <td><span className={`status-pill pill--${o.status.toLowerCase()}`}>● {o.status}</span></td>
                <td style={{ fontSize: 13 }}>{o.customerPhone ?? '—'}</td>
                <td style={{ fontSize: 13 }}>{o.scribeName ? `${o.scribeName} (${o.scribeId})` : 'Unassigned'}</td>
                <td><strong>{inr(o.customerTotal)}</strong></td>
                <td>
                  <button
                    className="btn btn-ghost sm"
                    onClick={() => setSelectedId(selectedId === o.id ? null : o.id)}
                  >
                    {selectedId === o.id ? 'Hide' : 'Inspect / Act'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card" style={{ marginTop: 16, padding: 20 }}>
          <h3>Order #{selected.id} — {selected.title}</h3>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            Status: <strong>{selected.status}</strong> · Customer: {selected.customerPhone ?? '—'} · Scribe: {selected.scribeId ?? 'none'}
          </p>

          <div className="field" style={{ maxWidth: 480, marginBottom: 12 }}>
            <label htmlFor="admin-op-reason">Audit reason (for reassign / refund)</label>
            <input
              id="admin-op-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Scribe unresponsive, customer requested refund"
            />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
            <button
              className="btn btn-ghost"
              disabled={busy || !['Accepted', 'Writing', 'Dispatched'].includes(selected.status)}
              onClick={() => runAction(`/api/admin/orders/${selected.id}/reassign`, { reason: reason || undefined }, `Order #${selected.id} reassigned.`)}
            >
              Reassign order
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || ['Cancelled', 'Closed'].includes(selected.status)}
              onClick={() => runAction(`/api/admin/orders/${selected.id}/refund`, { reason: reason || undefined }, `Refund recorded for #${selected.id}.`)}
            >
              Issue refund &amp; cancel
            </button>
          </div>

          <h4>Full timeline</h4>
          <div className="timeline-list" style={{ marginTop: 8 }}>
            {selected.timeline.map((ev, i) => (
              <div key={i} className="timeline-item">
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <div className="timeline-meta">
                    <strong>{ev.status}</strong>
                    <span className="timeline-time">{ev.timestamp}</span>
                  </div>
                  <p className="timeline-note">{ev.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 24, padding: 20 }}>
        <h3>Recent Audit Log</h3>
        {audit.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>No audit entries yet.</p>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {audit.map((a) => (
              <div key={a.id} style={{ fontSize: 13, borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--muted)', marginRight: 10 }}>{new Date(a.at).toLocaleString()}</span>
                <span>{a.entry}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
