/**
 * RiderPage.tsx
 * Public, phone-first page for the rider. No sign-in: the link itself is the key.
 * Step 1: type the pickup code the scribe reads out. Step 2: type the delivery code the recipient reads out.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'

interface Contact { name: string; phone: string }
interface Job {
  status: string
  pickupAddress: string
  dropGate: string
  pickupContact?: Contact
  dropContact?: Contact
}

function Place({ title, address, who }: { title: string; address: string; who?: Contact }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <strong>{title}</strong>
      <p style={{ margin: '6px 0' }}>{address}</p>
      {who?.phone && <a href={`tel:${who.phone}`}>{who.name || 'Call'} · {who.phone}</a>}
    </div>
  )
}

export default function RiderPage() {
  const { token = '' } = useParams()
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<{ task: Job }>('GET', `/api/rider/${token}`).then((r) => setJob(r.task)).catch((e: Error) => setError(e.message))
  }, [token])
  useEffect(load, [load])

  const send = async (step: 'pickup' | 'deliver') => {
    setBusy(true); setError('')
    try { await api('POST', `/api/rider/${token}/${step}`, { body: step === 'pickup' ? { pickupOtp: code } : { deliveryOtp: code } }); setCode(''); load() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  if (!job) return <main style={{ padding: 24 }}>{error || 'Loading...'}</main>
  const step = job.status === 'RIDER_ASSIGNED' ? 'pickup' : job.status === 'PICKED_UP' ? 'deliver' : null
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
      <h1 style={{ fontSize: 22 }}>ScribeLink delivery</h1>
      <Place title="1. Pick up from" address={job.pickupAddress} who={job.pickupContact} />
      <Place title="2. Deliver to" address={job.dropGate} who={job.dropContact} />
      {error && <p className="alert alert--warn" role="alert">{error}</p>}
      {step ? (
        <div className="card" style={{ padding: 16 }}>
          <label htmlFor="rider-code"><strong>{step === 'pickup' ? 'Pickup code (ask the scribe)' : 'Delivery code (ask the recipient)'}</strong></label>
          <input id="rider-code" inputMode="numeric" maxLength={6} value={code} placeholder="6-digit code"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ width: '100%', margin: '10px 0', fontSize: 24 }} />
          <button className="btn btn-primary" disabled={busy || code.length !== 6} onClick={() => send(step)}>
            {step === 'pickup' ? 'Confirm pickup' : 'Confirm delivery'}
          </button>
        </div>
      ) : (
        <p>{job.status === 'DELIVERED_AT_GATE' ? 'Delivered. Thank you.' : 'This job is not active.'}</p>
      )}
    </main>
  )
}
