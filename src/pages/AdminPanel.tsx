/**
 * pages/AdminPanel.tsx
 * Admin Panel for Phase 6:
 * 1. Verify Handwriting Cards submitted by onboarded scribes
 * 2. Unboxing-Video Dispute Triage (Review video, customer notes, refund or release escrow)
 * 3. Scribe Strike & Suspension Management
 * 4. WhatsApp & SMS Live Telemetry Log
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AdminScribeApproval, DisputeRecord, NotificationLog } from '../shared/logisticsDisputes'
import { api, fetchBlobUrl } from '../lib/api'
import { inr } from '../lib/pricing'

type Tab = 'cards' | 'disputes' | 'strikes' | 'notifications'

/** Plays a protected evidence video: it is fetched with the admin's token, then shown from a blob URL. */
function EvidenceVideo({ url }: { url: string }) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const isLocal = url.startsWith('/api/media/')
  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])
  if (!isLocal) return <a href={url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost sm">Open video link</a>
  return src ? (
    <video src={src} controls style={{ width: '100%', borderRadius: 10, marginTop: 8 }} />
  ) : (
    <>
      <button className="btn btn-ghost sm" style={{ marginTop: 8 }} onClick={() => fetchBlobUrl(url, 'admin').then(setSrc).catch((e: Error) => setError(e.message))}>
        ▶ Load unboxing video
      </button>
      {error && <p role="alert" style={{ color: 'var(--warn)', fontSize: 13 }}>{error}</p>}
    </>
  )
}

export default function AdminPanel() {
  const [scribes, setScribes] = useState<AdminScribeApproval[]>([])
  const [disputes, setDisputes] = useState<DisputeRecord[]>([])
  const [notifications, setNotifications] = useState<NotificationLog[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('cards')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [demoMode, setDemoMode] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, d, n] = await Promise.all([
        api<{ scribes: AdminScribeApproval[] }>('GET', '/api/admin/scribes', { as: 'admin' }),
        api<{ disputes: DisputeRecord[] }>('GET', '/api/admin/disputes', { as: 'admin' }),
        api<{ notifications: NotificationLog[] }>('GET', '/api/admin/notifications', { as: 'admin' }),
      ])
      setScribes(s.scribes)
      setDisputes(d.disputes)
      setNotifications(n.notifications)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads data from the API on mount; state is set after the request resolves
    void load()
    const id = setInterval(() => { if (!document.hidden) void load() }, 8000)
    api<{ production: boolean }>('GET', '/api/health').then((h) => setDemoMode(!h.production)).catch(() => {})
    return () => clearInterval(id)
  }, [load])

  /** Runs one admin action, then reloads the lists. */
  async function act(fn: () => Promise<unknown>, done: string) {
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(done)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleVerifyCard = (id: string, approved: boolean) =>
    act(() => api('POST', `/api/admin/scribes/${id}/verify`, { as: 'admin', body: { isApproved: approved } }), approved ? 'Card approved.' : 'Card rejected.')

  const handleStrike = (id: string, delta: number) =>
    act(() => api('POST', `/api/admin/scribes/${id}/strikes`, { as: 'admin', body: { delta } }), delta > 0 ? 'Strike issued.' : 'Strike pardoned.')

  const handleResolveDispute = (id: string, decision: 'REFUNDED_TO_CUSTOMER' | 'RELEASED_TO_SCRIBE' | 'SPLIT') =>
    act(
      () => api('POST', `/api/admin/disputes/${id}/resolve`, { as: 'admin', body: { decision, adminNotes: adminNote.trim() || 'Resolved after reviewing the unboxing video.' } }).then(() => setAdminNote('')),
      'Dispute resolved.',
    )

  const fastForward = () =>
    act(
      () => api('POST', '/api/cron/trigger-jobs', { as: 'admin', body: { simulatedTimestamp: new Date(Date.now() + 25 * 3600 * 1000).toISOString() } }),
      'Jumped 25 hours ahead: due escrow was released and missed check-ins were handled.',
    )

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <span className="eyebrow">Trust, Safety &amp; Governance</span>
          <h1 className="section-title">ScribeLink Admin Console</h1>
          <p className="section-sub">
            Verify handwriting cards, arbitrate unboxing-video disputes, and enforce strike policies.
          </p>
        </div>

        <Link to="/" className="btn btn-ghost" style={{ alignSelf: 'center' }}>
          Return to Portal
        </Link>
      </div>

      {error && <div className="alert alert--warn" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {notice && <div className="alert alert--ok" role="status" style={{ marginBottom: 12 }}>{notice}</div>}
      {demoMode && (
        <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: 'var(--muted)', flex: 1 }}>Demo tool: payouts normally release 24 hours after delivery.</span>
          <button className="btn btn-ghost sm" onClick={fastForward} id="fast-forward-btn">Fast-forward 25 hours</button>
        </div>
      )}

      {/* Admin Subnav Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab-btn ${activeTab === 'cards' ? 'tab-btn--active' : ''}`}
          onClick={() => setActiveTab('cards')}
        >
          Handwriting verification ({scribes.filter(s => !s.isApproved).length} pending)
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'disputes' ? 'tab-btn--active' : ''}`}
          onClick={() => setActiveTab('disputes')}
        >
          Video disputes ({disputes.filter(d => d.status === 'PENDING_REVIEW').length})
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'strikes' ? 'tab-btn--active' : ''}`}
          onClick={() => setActiveTab('strikes')}
        >
          Scribe strikes
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'notifications' ? 'tab-btn--active' : ''}`}
          onClick={() => setActiveTab('notifications')}
        >
          Message log ({notifications.length})
        </button>
      </div>

      {/* ── 1. Handwriting Card Verification Tab ── */}
      {activeTab === 'cards' && (
        <div className="admin-card-section">
          <h2>Pending &amp; Verified Scribe Cards</h2>
          {scribes.length === 0 && <div className="card empty-state" style={{ marginTop: 16 }}><p>No scribes have signed up yet.</p></div>}
          <div className="scribe-cards-grid" style={{ marginTop: 16 }}>
            {scribes.map(s => (
              <div key={s.scribeId} className="card admin-scribe-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{s.name}</h3>
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                      #{s.tag} · {s.college}
                    </p>
                  </div>
                  <span className={`status-pill ${s.isApproved ? 'pill--delivered' : 'pill--accepted'}`}>
                    {s.isApproved ? 'Verified' : 'Pending review'}
                  </span>
                </div>

                <div className="paper" style={{ padding: '16px 16px 36px 44px', margin: '14px 0', transform: 'none' }}>
                  <div className="paper-margin" />
                  {s.handwritingSampleUrl && <img src={s.handwritingSampleUrl} alt={`Handwriting sample by ${s.name}`} style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, marginBottom: 8 }} />}
                  <p className="scribble font-caveat">{s.sampleCardText}</p>
                  <div className="paper-tag">Sample #{s.tag}</div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {!s.isApproved ? (
                    <>
                      <button className="btn btn-primary full" onClick={() => handleVerifyCard(s.scribeId, true)}>
                        Approve
                      </button>
                      <button className="btn btn-ghost full" onClick={() => handleVerifyCard(s.scribeId, false)}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-ghost full" onClick={() => handleVerifyCard(s.scribeId, false)}>
                      Revoke Verification
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 2. Unboxing Video Disputes Tab ── */}
      {activeTab === 'disputes' && (
        <div className="admin-disputes-section">
          <h2>Customer Unboxing-Video Disputes</h2>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
            Disputes require a continuous unboxing video of the sealed envelope. Review footage and customer allegations.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18 }}>
            {disputes.length === 0 && <div className="card empty-state"><p>No disputes have been filed.</p></div>}
            {disputes.map(disp => (
              <div key={disp.id} className="card dispute-card">
                <div className="dispute-top">
                  <div>
                    <span className="status-pill pill--writing">Dispute #{disp.id}</span>
                    <h3 style={{ marginTop: 8 }}>Order #{disp.orderId} — Reason: {disp.reason.replace('_', ' ')}</h3>
                    <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                      Filed by: <strong>{disp.customerName}</strong> against Scribe: <strong>{disp.scribeName}</strong> · Amount in Escrow: <strong>{inr(disp.amount)}</strong>
                    </p>
                  </div>
                  <span className={`status-pill pill--${disp.status.toLowerCase().replace(/_/g, '-')}`}>
                    ● {disp.status}
                  </span>
                </div>

                <div className="dispute-details-grid">
                  <div className="customer-allegation">
                    <strong>Customer Complaint:</strong>
                    <p style={{ fontSize: 14, marginTop: 4 }}>"{disp.customerNotes}"</p>
                  </div>

                  <div className="video-proof-box">
                    <strong>Unboxing video evidence:</strong>
                    <EvidenceVideo url={disp.unboxingVideoUrl} />
                  </div>
                </div>

                {disp.status === 'PENDING_REVIEW' ? (
                  <div className="dispute-actions" style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                    <label htmlFor={`note-${disp.id}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Audit note (saved with the decision)</label>
                    <input id={`note-${disp.id}`} type="text" value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="Why this decision?" style={{ width: '100%', margin: '6px 0 10px' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Arbitration Decision:</span>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleResolveDispute(disp.id, 'REFUNDED_TO_CUSTOMER')}
                      >
                        Refund Customer (100%)
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleResolveDispute(disp.id, 'RELEASED_TO_SCRIBE')}
                      >
                        Release to Scribe (Deny Claim)
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleResolveDispute(disp.id, 'SPLIT')}
                      >
                        50/50 Goodwill Split
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 14, background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                    <strong>Resolution Audit:</strong> {disp.adminNotes || 'Closed'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. Scribe Strike Management Tab ── */}
      {activeTab === 'strikes' && (
        <div className="admin-strikes-section">
          <h2>Scribe Performance &amp; Strike Sanctions</h2>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
            Strikes are automatically issued on missed hourly check-ins or manual administrative policy violations. 3 strikes result in permanent suspension.
          </p>

          <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
            <table className="payout-table">
              <thead>
                <tr>
                  <th>Scribe</th>
                  <th>Campus</th>
                  <th>Strikes</th>
                  <th>Account Status</th>
                  <th>Adjust Strike</th>
                </tr>
              </thead>
              <tbody>
                {scribes.map(s => (
                  <tr key={s.scribeId}>
                    <td><strong>{s.name}</strong> (#{s.tag})</td>
                    <td>{s.college}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: s.strikes > 0 ? '#b45309' : 'var(--ok)' }}>
                        {s.strikes} / 3
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${s.isSuspended ? 'pill--dispatched' : 'pill--delivered'}`}>
                        {s.isSuspended ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleStrike(s.scribeId, 1)}>
                          + Issue Strike
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleStrike(s.scribeId, -1)} disabled={s.strikes <= 0}>
                          - Pardon Strike
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 4. WhatsApp / SMS Logs Tab ── */}
      {activeTab === 'notifications' && (
        <div className="admin-notifs-section">
          <h2>Outbound WhatsApp &amp; SMS Gateway Feed</h2>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="timeline-list" style={{ padding: 20 }}>
              {notifications.length === 0 && <p style={{ color: 'var(--muted)' }}>No messages sent yet.</p>}
              {notifications.map(n => (
                <div key={n.id} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-content">
                    <div className="timeline-meta">
                      <strong>[{n.channel}] &rarr; {n.recipient} ({n.templateName})</strong>
                      <span className="timeline-time">{n.sentAt}</span>
                    </div>
                    <p className="timeline-note">{n.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
