/**
 * GatePicker.tsx
 * Lets a customer choose where the finished pages are delivered: a saved gate or a new one.
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import AddressForm, { emptyAddress, toApiAddress, type AddressFields } from './AddressForm'

interface Saved { id: string; label: string; college: string; line: string; landmark?: string; pincode: string; contactName: string }

export default function GatePicker({ value, onChange }: { value: string | null; onChange: (gateId: string | null) => void }) {
  const [gates, setGates] = useState<Saved[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<AddressFields>(emptyAddress)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api<{ addresses: Saved[] }>('GET', '/api/addresses', { as: 'customer' })
      .then((r) => {
        setGates(r.addresses)
        setAdding(r.addresses.length === 0)
        if (r.addresses[0]) onChange(r.addresses[0].id)
      })
      .catch((e: Error) => { setGates([]); setAdding(true); setError(e.message) })
    // Runs once when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const r = await api<{ address: Saved }>('POST', '/api/addresses', { as: 'customer', body: toApiAddress(form) })
      setGates((g) => [...(g ?? []), r.address])
      onChange(r.address.id)
      setForm(emptyAddress)
      setAdding(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    await api('DELETE', `/api/addresses/${id}`, { as: 'customer' }).catch(() => undefined)
    setGates((g) => (g ?? []).filter((x) => x.id !== id))
    if (value === id) onChange(null)
  }

  return (
    <div className="summary-section card" id="gate-picker">
      <h3 className="summary-heading">Where should we deliver?</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
        A rider brings your pages to this gate. The person named here reads out your delivery code to receive them.
      </p>

      {gates === null && <p className="section-sub">Loading your saved places...</p>}

      {gates?.map((g) => (
        <div key={g.id} className={`gate-option${value === g.id ? ' gate-option--active' : ''}`}>
          <label>
            <input type="radio" name="gate" checked={value === g.id} onChange={() => onChange(g.id)} />
            <span>
              <strong>{g.label}</strong>
              <span className="gate-line">{g.line}{g.landmark ? `, ${g.landmark}` : ''}, {g.college} {g.pincode}</span>
              <span className="gate-line">Hand over to {g.contactName}</span>
            </span>
          </label>
          <button type="button" className="btn btn-ghost sm" onClick={() => remove(g.id)} aria-label={`Remove ${g.label}`}>Remove</button>
        </div>
      ))}

      {adding ? (
        <div className="gate-new">
          <AddressForm value={form} onChange={setForm} lineLabel="Gate or street" idPrefix="gate" />
          {error && <div className="alert alert--warn" role="alert">{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving} id="gate-save-btn">{saving ? 'Saving...' : 'Save this gate'}</button>
            {gates && gates.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>}
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost sm" onClick={() => setAdding(true)}>Add another gate</button>
      )}
    </div>
  )
}
