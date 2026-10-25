/**
 * Phone + one-time-code sign-in, shown in place of a page that needs a session.
 * In demo mode the API returns the code and this form fills it in, so no SMS is needed.
 */

import { useState, type ReactNode } from 'react'
import { sendOtp, useSessions, verifyOtp, type Role } from '../lib/api'

const COPY: Record<Role, { title: string; sub: string }> = {
  customer: { title: 'Sign in to place and track orders', sub: 'Use your mobile number. No password needed.' },
  scribe: { title: 'Scribe sign-in', sub: 'Sign in with the mobile number you will use as a scribe.' },
  admin: { title: 'Admin sign-in', sub: 'Only numbers on the admin allowlist can sign in here.' },
}

export function SignInCard({ role }: { role: Role }) {
  const [digits, setDigits] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [demoNote, setDemoNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const phone = `+91${digits}`

  async function send() {
    setError('')
    if (!/^[6-9]\d{9}$/.test(digits)) return setError('Enter a 10-digit Indian mobile number.')
    setBusy(true)
    try {
      const r = await sendOtp(phone)
      setSent(true)
      if (r.devOtp) {
        setCode(r.devOtp)
        setDemoNote('Demo mode: your code was filled in for you.')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setError('')
    setBusy(true)
    try {
      await verifyOtp(role, phone, code)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 56, paddingBottom: 56 }}>
      <div className="card" style={{ padding: 28 }}>
        <h2 style={{ fontSize: 24 }}>{COPY[role].title}</h2>
        <p className="section-sub" style={{ margin: '8px 0 20px', fontSize: 15 }}>{COPY[role].sub}</p>

        <label htmlFor="signin-phone" style={{ fontSize: 13, fontWeight: 600 }}>Mobile number</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <span className="card" style={{ padding: '12px 14px', display: 'grid', placeItems: 'center' }}>+91</span>
          <input
            id="signin-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            value={digits}
            disabled={sent}
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))}
            style={{ flex: 1, minWidth: 0 }}
          />
        </div>

        {sent && (
          <>
            <label htmlFor="signin-code" style={{ fontSize: 13, fontWeight: 600, display: 'block', marginTop: 14 }}>6-digit code</label>
            <input
              id="signin-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ width: '100%', marginTop: 6 }}
            />
            {demoNote && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{demoNote}</p>}
          </>
        )}

        {error && <p className="alert alert--warn" role="alert" style={{ marginTop: 14 }}>{error}</p>}

        <button
          className="btn btn-primary full"
          style={{ marginTop: 18 }}
          disabled={busy || (sent ? code.length !== 6 : digits.length !== 10)}
          onClick={sent ? verify : send}
          id="signin-submit"
        >
          {busy ? 'Please wait…' : sent ? 'Verify and continue' : 'Send code'}
        </button>
      </div>
    </div>
  )
}

/** Renders its children only while a session exists for one of the allowed roles. */
export function RequireAuth({ roles, children }: { roles: Role[]; children: (active: Role) => ReactNode }) {
  const sessions = useSessions()
  const active = roles.find((r) => sessions[r])
  if (!active) return <SignInCard role={roles[0]} />
  return <>{children(active)}</>
}
