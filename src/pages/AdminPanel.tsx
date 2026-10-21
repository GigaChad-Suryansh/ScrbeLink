/**
 * pages/AdminPanel.tsx
 * Admin Panel for Phase 6:
 * 1. Verify Handwriting Cards submitted by onboarded scribes
 * 2. Unboxing-Video Dispute Triage (Review video, customer notes, refund or release escrow)
 * 3. Scribe Strike & Suspension Management
 * 4. WhatsApp & SMS Live Telemetry Log
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { globalLogistics } from '../backend/logisticsService'
import type { AdminScribeApproval, DisputeRecord, NotificationLog } from '../shared/logisticsDisputes'
import { inr } from '../lib/pricing'

export default function AdminPanel() {
  const [scribes, setScribes] = useState<AdminScribeApproval[]>(globalLogistics.getAllScribes())
  const [disputes, setDisputes] = useState<DisputeRecord[]>(globalLogistics.getAllDisputes())
  const [notifications, setNotifications] = useState<NotificationLog[]>(globalLogistics.getNotificationLogs())
  const [activeTab, setActiveTab] = useState<'cards' | 'disputes' | 'strikes' | 'notifications'>('cards')

  function handleVerifyCard(scribeId: string, approved: boolean) {
    const updated = globalLogistics.verifyScribeCard(scribeId, approved)
    setScribes(globalLogistics.getAllScribes())
    alert(`Handwriting sample card for ${updated.name} has been ${approved ? 'APPROVED' : 'REJECTED'}.`)
  }

  function handleStrike(scribeId: string, delta: number) {
    const updated = globalLogistics.manageScribeStrike(scribeId, delta)
    setScribes(globalLogistics.getAllScribes())
    if (updated.isSuspended) {
      alert(`⚠️ Scribe ${updated.name} now has ${updated.strikes} strikes and is automatically SUSPENDED.`)
    }
  }

  function handleResolveDispute(disputeId: string, decision: 'REFUNDED_TO_CUSTOMER' | 'RELEASED_TO_SCRIBE' | 'SPLIT') {
    const reason = prompt('Enter Admin Resolution Audit Note:') || 'Resolved following unboxing video review.'
    globalLogistics.resolveDispute(disputeId, decision, reason)
    setDisputes(globalLogistics.getAllDisputes())
    setNotifications(globalLogistics.getNotificationLogs())
  }

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
          ← Return to Portal
        </Link>
      </div>

      {/* Admin Subnav Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab-btn ${activeTab === 'cards' ? 'tab-btn--active' : ''}`}
          onClick={() => setActiveTab('cards')}
        >
          🖋️ Handwriting Verification ({scribes.filter(s => !s.isApproved).length} pending)
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'disputes' ? 'tab-btn--active' : ''}`}
          onClick={() => setActiveTab('disputes')}
        >
          📹 Video Disputes ({disputes.filter(d => d.status === 'PENDING_REVIEW').length})
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'strikes' ? 'tab-btn--active' : ''}`}
          onClick={() => setActiveTab('strikes')}
        >
          ⚡ Scribe Strike Management
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'notifications' ? 'tab-btn--active' : ''}`}
          onClick={() => {
            setNotifications(globalLogistics.getNotificationLogs())
            setActiveTab('notifications')
          }}
        >
          📲 WhatsApp / SMS Gateway Logs ({notifications.length})
        </button>
      </div>

      {/* ── 1. Handwriting Card Verification Tab ── */}
      {activeTab === 'cards' && (
        <div className="admin-card-section">
          <h2>Pending &amp; Verified Scribe Cards</h2>
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
                    {s.isApproved ? '✓ VERIFIED' : '⏳ PENDING REVIEW'}
                  </span>
                </div>

                <div className="paper" style={{ padding: '16px 16px 36px 44px', margin: '14px 0', transform: 'none' }}>
                  <div className="paper-margin" />
                  <p className="scribble font-caveat">{s.sampleCardText}</p>
                  <div className="paper-tag">Sample #{s.tag}</div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {!s.isApproved ? (
                    <>
                      <button className="btn btn-primary full" onClick={() => handleVerifyCard(s.scribeId, true)}>
                        ✓ Approve Card
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
                    <strong>📹 Unboxing Video Evidence:</strong>
                    <div className="video-player-sim">
                      <span>▶ Play {disp.orderId}_unboxing_proof.mp4</span>
                    </div>
                  </div>
                </div>

                {disp.status === 'PENDING_REVIEW' ? (
                  <div className="dispute-actions" style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
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
                        {s.isSuspended ? '⛔ SUSPENDED' : 'ACTIVE'}
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
