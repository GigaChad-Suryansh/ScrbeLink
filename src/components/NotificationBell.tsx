/**
 * NotificationBell.tsx
 * Message list with an unread count. Opening it marks everything read.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type Role } from '../lib/api'

interface Item { id: string; content: string; at: string; read: boolean }

export default function NotificationBell({ role }: { role: Role }) {
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    api<{ items: Item[]; unread: number }>('GET', '/api/notifications', { as: role })
      .then((r) => { setItems(r.items); setUnread(r.unread) })
      .catch(() => undefined)
  }, [role])
  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0) api('POST', '/api/notifications/read', { as: role }).then(() => setUnread(0)).catch(() => undefined)
  }

  return (
    <span style={{ position: 'relative' }}>
      <button type="button" className="btn btn-ghost sm" onClick={toggle} aria-expanded={open} id="notif-btn">
        Messages{unread > 0 && ` (${unread})`}
      </button>
      {open && (
        <div className="card" role="region" aria-label="Messages" style={{ position: 'absolute', right: 0, top: '110%', width: 320, maxHeight: 360, overflowY: 'auto', padding: 12, zIndex: 20 }}>
          {items.length === 0 ? <p style={{ margin: 0, color: 'var(--muted)' }}>No messages yet.</p> : items.map((i) => (
            <div key={i.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line, #e5e5ea)', fontSize: 14 }}>
              <div>{i.content.replace(/^ScribeLink:\s*/, '')}</div>
              <small style={{ color: 'var(--muted)' }}>{new Date(i.at).toLocaleString()}</small>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
