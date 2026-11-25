/**
 * AdminCouriers.tsx
 * The queue of parcels waiting for a rider. The admin books Porter by hand, then types in the rider here.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Task {
  orderId: string
  status: 'BOOKING_REQUESTED' | 'RIDER_ASSIGNED' | 'PICKED_UP'
  pickupAddress: string
  dropGate: string
  pickupContact?: { name: string; phone: string }
  riderName?: string
  riderPhone?: string
  attempts: number
  needsAttention: boolean
  riderLink?: string
}

const LABEL = { BOOKING_REQUESTED: 'Needs a rider', RIDER_ASSIGNED: 'Rider assigned', PICKED_UP: 'On the way' }

function Row({ t, reload }: { t: Task; reload: () => void }) {
  const [f, setF] = useState({ riderName: '', riderPhone: '', trackingUrl: '' })
  const [msg, setMsg] = useState('')
  const [links, setLinks] = useState<{ riderLink?: string; whatsapp?: string }>({ riderLink: t.riderLink })

  const run = async (fn: () => Promise<void>) => {
    setMsg('')
    try { await fn(); reload() } catch (e) { setMsg((e as Error).message) }
  }
  const assign = () => run(async () => {
    const r = await api<{ riderLink: string; whatsapp: string }>('POST', `/api/admin/courier/${t.orderId}/assign`, { as: 'admin', body: f })
    setLinks(r)
  })
  const rebook = () => run(async () => {
    const reason = window.prompt('Why does this need a new rider?')
    if (reason) await api('POST', `/api/admin/courier/${t.orderId}/rebook`, { as: 'admin', body: { reason } })
  })

  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
      <strong>{t.orderId} · {LABEL[t.status]}{t.needsAttention && ' · needs attention'}</strong>
      <span>From: {t.pickupAddress}{t.pickupContact && ` (${t.pickupContact.name} ${t.pickupContact.phone})`}</span>
      <span>To: {t.dropGate}</span>
      {t.status !== 'PICKED_UP' && (
        <div className="card-actions" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Rider name" aria-label="Rider name" value={f.riderName} onChange={(e) => setF({ ...f, riderName: e.target.value })} />
          <input placeholder="Rider phone" aria-label="Rider phone" value={f.riderPhone} onChange={(e) => setF({ ...f, riderPhone: e.target.value })} />
          <input placeholder="Tracking link (optional)" aria-label="Tracking link" value={f.trackingUrl} onChange={(e) => setF({ ...f, trackingUrl: e.target.value })} />
          <button className="btn btn-primary" disabled={!f.riderName || !f.riderPhone} onClick={assign}>
            {t.status === 'BOOKING_REQUESTED' ? 'Assign rider' : 'Replace rider'}
          </button>
        </div>
      )}
      {t.riderName && <span>Rider: {t.riderName} {t.riderPhone}</span>}
      {links.riderLink && (
        <div className="card-actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => void navigator.clipboard?.writeText(links.riderLink!)}>Copy rider link</button>
          {links.whatsapp && <a className="btn btn-ghost" href={links.whatsapp} target="_blank" rel="noreferrer">Send on WhatsApp</a>}
        </div>
      )}
      {t.status === 'RIDER_ASSIGNED' && <button className="btn btn-ghost" onClick={rebook}>Rider cancelled, rebook</button>}
      {msg && <p className="alert alert--warn" role="alert">{msg}</p>}
    </div>
  )
}

export default function AdminCouriers({ onCount }: { onCount?: (n: number) => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const load = useCallback(() => {
    api<{ tasks: Task[] }>('GET', '/api/admin/courier', { as: 'admin' }).then((r) => { setTasks(r.tasks); onCount?.(r.tasks.length) }).catch(() => undefined)
  }, [onCount])
  useEffect(() => { load() }, [load])

  return (
    <div className="admin-card-section">
      <h2>Couriers</h2>
      <p style={{ color: 'var(--muted)' }}>Book a Porter for each parcel, then enter the rider here. The rider link opens a page where they type the pickup and delivery codes.</p>
      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {tasks === null ? <p>Loading...</p> : tasks.length === 0 ? <p style={{ color: 'var(--muted)' }}>No parcels waiting.</p>
          : tasks.map((t) => <Row key={t.orderId + t.status + t.attempts} t={t} reload={load} />)}
      </div>
    </div>
  )
}
