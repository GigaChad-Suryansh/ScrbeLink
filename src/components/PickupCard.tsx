/**
 * PickupCard.tsx
 * A scribe's pickup address: where the rider collects the finished pages.
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import AddressForm, { emptyAddress, toApiAddress, type AddressFields } from './AddressForm'

interface Saved { id: string; college: string; line: string; landmark?: string; pincode: string; contactName: string }

export default function PickupCard() {
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<AddressFields>(emptyAddress)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ addresses: Saved[] }>('GET', '/api/addresses', { as: 'scribe' })
      .then((r) => { setSaved(r.addresses[0] ?? null); setEditing(!r.addresses[0]) })
      .catch(() => { setSaved(null); setEditing(true) })
  }, [])

  async function save() {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ address: Saved }>('POST', '/api/addresses', { as: 'scribe', body: toApiAddress(form) })
      setSaved(r.address)
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24, padding: 24 }} id="pickup-card">
      <h3 className="form-section-title">Pickup address</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        When you finish an order, a rider collects the pages here. Only the rider sees this address, not customers.
      </p>
      {saved === undefined && <p className="section-sub">Loading...</p>}
      {saved && !editing && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <strong>{saved.line}</strong>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{saved.landmark ? `${saved.landmark}, ` : ''}{saved.college} {saved.pincode}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Rider calls {saved.contactName}</div>
          </div>
          <button type="button" className="btn btn-ghost sm" onClick={() => setEditing(true)}>Change</button>
        </div>
      )}
      {editing && (
        <>
          <AddressForm value={form} onChange={setForm} lineLabel="Hostel, room or street" idPrefix="pickup" />
          {error && <div className="alert alert--warn" role="alert">{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy} id="pickup-save-btn">{busy ? 'Saving...' : 'Save pickup address'}</button>
            {saved && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </>
      )}
    </div>
  )
}
