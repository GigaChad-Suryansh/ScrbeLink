/**
 * pages/LegalPage.tsx
 * Phase 18: Terms, Privacy (DPDP Act), Refunds, Academic Integrity, and Contact.
 * Includes DPDP data export / deletion controls and a misuse report form.
 */

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, signOutAll, useSessions, type Role } from '../lib/api'
import { POLICY_VERSION, type LegalDocSlug } from '../shared/legal'
import { Footer } from '../components/Sections'

const TITLES: Record<LegalDocSlug, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy (DPDP Act)',
  refunds: 'Refund & Cancellation Policy',
  integrity: 'Academic Integrity Policy',
  contact: 'Contact & Grievance Officer',
}

function DpdpControls({ role }: { role: Role }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function downloadData() {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await api<{ data: unknown }>('GET', '/api/account/data-export', { as: role })
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'scribelink-my-data.json'
      a.click()
      URL.revokeObjectURL(url)
      setMsg('Your data export has been downloaded.')
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  async function deleteData() {
    if (!window.confirm('Delete your personal data and anonymize your order history? This cannot be undone.')) return
    setBusy(true); setErr(''); setMsg('')
    try {
      await api('DELETE', '/api/account/data', { as: role })
      signOutAll()
      setMsg('Your personal data has been deleted and you have been signed out.')
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 24 }}>
      <h3>Your DPDP Act Data Rights</h3>
      <p style={{ fontSize: 14, color: 'var(--muted)', margin: '6px 0 14px' }}>
        You can download a copy of your stored data or request deletion at any time.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" disabled={busy} onClick={downloadData}>Download my data (JSON)</button>
        <button className="btn btn-primary" disabled={busy} onClick={deleteData}>Delete my personal data</button>
      </div>
      {msg && <p className="alert alert--ok" style={{ marginTop: 12 }}>{msg}</p>}
      {err && <p className="alert alert--warn" role="alert" style={{ marginTop: 12 }}>{err}</p>}
    </div>
  )
}

function MisuseReportForm({ role }: { role: Role }) {
  const [targetType, setTargetType] = useState<'order' | 'scribe' | 'customer' | 'other'>('order')
  const [targetId, setTargetId] = useState('')
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(''); setDone('')
    try {
      const r = await api<{ report: { id: string } }>('POST', '/api/reports', {
        as: role,
        body: { targetType, targetId, reason, details },
      })
      setDone(`Report ${r.report.id} submitted for admin review.`)
      setTargetId(''); setReason(''); setDetails('')
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 24 }}>
      <h3>Report misuse or prohibited material</h3>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <div className="field">
          <label htmlFor="rpt-type">What are you reporting?</label>
          <select id="rpt-type" value={targetType} onChange={(e) => setTargetType(e.target.value as typeof targetType)}>
            <option value="order">Order / uploaded material</option>
            <option value="scribe">Scribe</option>
            <option value="customer">Customer</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rpt-id">Order or Scribe ID</label>
          <input id="rpt-id" type="text" required value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="e.g. SL-1042 or S-1234" />
        </div>
        <div className="field">
          <label htmlFor="rpt-reason">Reason</label>
          <input id="rpt-reason" type="text" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Exam question paper / cover page" />
        </div>
        <div className="field">
          <label htmlFor="rpt-details">Details (optional)</label>
          <textarea id="rpt-details" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        {done && <p className="alert alert--ok">{done}</p>}
        {err && <p className="alert alert--warn" role="alert">{err}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Submitting…' : 'Submit report'}
        </button>
      </form>
    </div>
  )
}

export default function LegalPage() {
  const { doc } = useParams<{ doc: string }>()
  const slug: LegalDocSlug = (doc && doc in TITLES ? doc : 'terms') as LegalDocSlug
  const sessions = useSessions()
  const activeRole = (['customer', 'scribe', 'admin'] as Role[]).find((r) => sessions[r])

  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="logo">Scribe<span>Link</span></Link>
          <nav aria-label="Legal navigation">
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/refunds">Refunds</Link>
            <Link to="/legal/integrity">Academic integrity</Link>
            <Link to="/legal/contact">Contact</Link>
          </nav>
        </div>
      </header>

      <main className="container" style={{ maxWidth: 780, paddingTop: 48, paddingBottom: 64 }}>
        <span className="eyebrow">Policy version {POLICY_VERSION}</span>
        <h1 className="section-title" style={{ marginTop: 6 }}>{TITLES[slug]}</h1>

        <div className="card" style={{ padding: 28, marginTop: 20, lineHeight: 1.7 }}>
          {slug === 'terms' && (
            <>
              <p>ScribeLink is a peer-to-peer handwritten transcription marketplace. Customers upload finished study notes they own and commission verified scribes to transcribe them onto paper.</p>
              <h3 style={{ marginTop: 18 }}>1. Eligibility &amp; Accounts</h3>
              <p>You must provide a valid Indian mobile number and accept these terms at sign-up. Scribes must complete identity and PAN verification before receiving payouts.</p>
              <h3 style={{ marginTop: 18 }}>2. Delivery &amp; Escrow</h3>
              <p>Deliveries are made to campus gates or public pickup points via our logistics partners. Payments are held in escrow for 24 hours after gate delivery.</p>
            </>
          )}

          {slug === 'privacy' && (
            <>
              <p>We process your personal data in accordance with India&apos;s Digital Personal Data Protection (DPDP) Act.</p>
              <h3 style={{ marginTop: 18 }}>1. Data We Collect</h3>
              <p>Mobile number, saved campus gate addresses, uploaded notes, unboxing dispute videos, and (for scribes) encrypted PAN and college ID verification.</p>
              <h3 style={{ marginTop: 18 }}>2. Retention</h3>
              <p>Uploaded customer notes are stored privately and automatically deleted 7 days after an order closes. You may download or delete your personal data below.</p>
            </>
          )}

          {slug === 'refunds' && (
            <>
              <p>Customers may cancel any time before a scribe starts writing for a 100% refund. Orders unaccepted for 6 hours are automatically cancelled and refunded in full.</p>
              <p style={{ marginTop: 12 }}>Once writing begins, cancellations are not permitted. If delivered pages are illegible, missing, or damaged, file a dispute with an unboxing video within 24 hours of delivery.</p>
            </>
          )}

          {slug === 'integrity' && (
            <>
              <p>ScribeLink strictly prohibits transcribing exam question papers, confidential assessments, or forged cover pages containing student roll numbers or institutional declarations.</p>
              <p style={{ marginTop: 12 }}>If a college or university restricts third-party transcription services, ScribeLink delivers strictly to public campus gates and does not assist in bypassing institutional rules.</p>
            </>
          )}

          {slug === 'contact' && (
            <>
              <p>For support, legal notices, or DPDP Act data grievances, contact our Grievance Officer:</p>
              <p style={{ marginTop: 12 }}><strong>Email:</strong> support@scribelink.in</p>
              <p><strong>Response time:</strong> Within 48 hours for order tickets; within 7 days for DPDP data requests.</p>
            </>
          )}
        </div>

        {slug === 'privacy' && activeRole && <DpdpControls role={activeRole} />}
        {slug === 'integrity' && activeRole && <MisuseReportForm role={activeRole} />}
      </main>

      <Footer />
    </>
  )
}
