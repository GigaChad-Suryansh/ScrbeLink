/**
 * HelpTicket.tsx
 * Opens a support ticket about an order and shows the answers to earlier ones.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type Role } from '../lib/api'

interface Ticket { id: string; orderId: string | null; subject: string; status: string; reply: string }

export default function HelpTicket({ orderId, role }: { orderId: string; role: Role }) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api<{ tickets: Ticket[] }>('GET', '/api/tickets', { as: role }).then((r) => setTickets(r.tickets.filter((t) => t.orderId === orderId))).catch(() => undefined)
  }, [orderId, role])
  useEffect(() => { load() }, [load])

  const send = async () => {
    setError('')
    try { await api('POST', '/api/tickets', { as: role, body: { orderId, subject, body } }); setSubject(''); setBody(''); setOpen(false); load() }
    catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }} id="help-ticket">
      <strong>Need help with this order?</strong>
      {tickets.map((t) => (
        <p key={t.id} style={{ margin: '8px 0 0', fontSize: 14 }}>
          {t.id} · {t.subject} · {t.status === 'OPEN' ? 'waiting for our reply' : `answered: ${t.reply}`}
        </p>
      ))}
      {open ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <input aria-label="Subject" placeholder="Subject" maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea aria-label="What happened?" placeholder="What happened?" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
          {error && <p className="alert alert--warn" role="alert">{error}</p>}
          <div className="card-actions">
            <button className="btn btn-primary" disabled={subject.length < 3 || body.length < 5} onClick={send}>Send</button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : <div><button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>Contact support</button></div>}
    </div>
  )
}
