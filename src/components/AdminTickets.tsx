/**
 * AdminTickets.tsx
 * Support inbox, plus scribes whose average rating has dropped.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Ticket { id: string; orderId: string | null; phone: string; subject: string; body: string; status: string; reply: string }
interface Low { scribeId: string; average: number; count: number }

function Row({ t, reload }: { t: Ticket; reload: () => void }) {
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const close = async () => {
    try { await api('POST', `/api/admin/tickets/${t.id}/close`, { as: 'admin', body: { reply } }); reload() }
    catch (e) { setError((e as Error).message) }
  }
  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 6 }}>
      <strong>{t.id} · {t.subject} · {t.status}</strong>
      <span style={{ fontSize: 14 }}>{t.phone}{t.orderId && ` · order ${t.orderId}`}</span>
      <span>{t.body}</span>
      {t.status === 'OPEN' ? (
        <div className="card-actions">
          <input aria-label="Reply" placeholder="Reply" value={reply} onChange={(e) => setReply(e.target.value)} />
          <button className="btn btn-primary" disabled={!reply} onClick={close}>Answer and close</button>
        </div>
      ) : <span style={{ color: 'var(--muted)' }}>Reply: {t.reply}</span>}
      {error && <p className="alert alert--warn" role="alert">{error}</p>}
    </div>
  )
}

export default function AdminTickets() {
  const [data, setData] = useState<{ tickets: Ticket[]; lowRated: Low[] } | null>(null)
  const load = useCallback(() => { api<{ tickets: Ticket[]; lowRated: Low[] }>('GET', '/api/admin/tickets', { as: 'admin' }).then(setData).catch(() => undefined) }, [])
  useEffect(() => { load() }, [load])
  return (
    <div className="admin-card-section">
      <h2>Support</h2>
      {data && data.lowRated.length > 0 && (
        <div className="alert alert--warn">
          Low-rated scribes: {data.lowRated.map((s) => `${s.scribeId} (${s.average} from ${s.count})`).join(', ')}
        </div>
      )}
      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {!data ? <p>Loading...</p> : data.tickets.length === 0 ? <p style={{ color: 'var(--muted)' }}>No tickets.</p> : data.tickets.map((t) => <Row key={t.id + t.status} t={t} reload={load} />)}
      </div>
    </div>
  )
}
