/**
 * ScribeDashboard.tsx
 * Scribe Dashboard showing:
 * - Nearby pending orders (with accept action)
 * - 30-minute intake inspection countdown timer
 * - Hourly rush check-ins submission
 * - Active writing orders management
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useScribePortal } from '../lib/scribeStore'
import { inr } from '../lib/pricing'

export default function ScribeDashboard() {
  const { profile, orders, acceptOrder, advanceOrderStatus, submitCheckIn } = useScribePortal()
  const [checkinNote, setCheckinNote] = useState('')
  const [activeCheckinOrder, setActiveCheckinOrder] = useState<string | null>(null)

  const pendingOrders = orders.filter(o => o.status === 'Paid')
  const activeOrders = orders.filter(o => ['Accepted', 'Writing', 'Dispatched'].includes(o.status))

  return (
    <div className="scribe-dashboard-page">
      {/* Scribe Top Banner */}
      <div className="scribe-dash-header">
        <div>
          <span className="eyebrow">Scribe Partner Workspace</span>
          <h1 className="section-title">Welcome back, {profile.name} 👋</h1>
          <p className="section-sub">
            Campus: <strong>{profile.college}</strong> · Rating: ★ {profile.rating} ({profile.totalOrders} completed)
          </p>
        </div>

        <div className="dash-quick-stats">
          <div className="dash-stat-box card">
            <span className="stat-label">Pending Escrow</span>
            <span className="stat-val">{inr(profile.pendingEscrow)}</span>
          </div>
          <div className="dash-stat-box card">
            <span className="stat-label">Ready Payout</span>
            <span className="stat-val stat-val--ok">{inr(profile.walletBalance)}</span>
          </div>
          <Link to="/scribe/earnings" className="btn btn-primary" style={{ alignSelf: 'center' }}>
            View Earnings ➔
          </Link>
        </div>
      </div>

      {/* Intake / Rush Check-in Alert Banner */}
      {activeOrders.some(o => o.status === 'Accepted' || o.status === 'Writing') && (
        <div className="urgent-action-card card">
          <div className="urgent-badge">Action Required</div>
          <div className="urgent-content">
            <h3>Active Task Timers</h3>
            <p>
              • <strong>30-Minute Intake Rule:</strong> Verify note quality, word count, and template match before beginning transcription.
              <br />
              • <strong>Hourly Rush Check-ins:</strong> Upload progress snapshots every hour to prevent order reassignment.
            </p>
          </div>
        </div>
      )}

      {/* Main Grid: Active Orders & Nearby Marketplace */}
      <div className="scribe-dash-grid">
        {/* Left: Active In-Progress Tasks */}
        <div className="dash-column">
          <div className="column-header">
            <h2>Your Active Assignments ({activeOrders.length})</h2>
            <span className="muted-tag">State Machine Controlled</span>
          </div>

          {activeOrders.length === 0 ? (
            <div className="card empty-state">
              <p>No orders in progress right now. Accept an order from nearby requests below!</p>
            </div>
          ) : (
            <div className="active-orders-list">
              {activeOrders.map(order => (
                <div key={order.id} className="card active-order-card">
                  <div className="active-card-top">
                    <div>
                      <span className={`status-pill pill--${order.status.toLowerCase()}`}>
                        ● {order.status}
                      </span>
                      <h3 style={{ marginTop: 8 }}>{order.title}</h3>
                      <p className="order-sub-meta">
                        Order #{order.id} · {order.subject} · {order.pages} pages ({order.words} words)
                      </p>
                    </div>
                    <div className="payout-badge">
                      <span className="payout-title">Your Cut</span>
                      <span className="payout-num">{inr(order.scribePayout)}</span>
                    </div>
                  </div>

                  <div className="active-card-body">
                    <div className="spec-chips">
                      <span className="spec-chip">🖊 {order.penStyle}</span>
                      {order.addons.map(a => (
                        <span key={a} className="spec-chip">📎 {a}</span>
                      ))}
                    </div>

                    {/* Step-specific controls */}
                    {order.status === 'Accepted' && (
                      <div className="intake-inspection-box">
                        <div className="inspection-timer">
                          ⏳ <strong>30-Minute Intake Inspection:</strong> 18 mins left to confirm or flag quality.
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                          Review the customer's text. Ensure no illicit cover pages or mismatched diagram requirements.
                        </p>
                        <div className="card-actions" style={{ marginTop: 12 }}>
                          <button
                            className="btn btn-primary"
                            onClick={() => advanceOrderStatus(order.id, 'Writing', '30-minute intake inspection passed. Writing initiated.')}
                          >
                            ✓ Confirm Intake &amp; Start Writing
                          </button>
                          <Link to={`/track/${order.id}`} className="btn btn-ghost">
                            View Customer View
                          </Link>
                        </div>
                      </div>
                    )}

                    {order.status === 'Writing' && (
                      <div className="writing-checkin-box">
                        <div className="checkin-timer">
                          ⏱ Next Hourly Rush Check-in: <strong>{order.nextCheckInDueAt || '42 mins'}</strong>
                        </div>
                        
                        {activeCheckinOrder === order.id ? (
                          <div className="checkin-form">
                            <input
                              type="text"
                              placeholder="e.g. Completed pages 1-6. Starting diagram 2..."
                              value={checkinNote}
                              onChange={e => setCheckinNote(e.target.value)}
                              className="checkin-input"
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <button
                                className="btn btn-primary"
                                onClick={() => {
                                  submitCheckIn(order.id)
                                  advanceOrderStatus(order.id, 'Writing', checkinNote ? `Check-in update: ${checkinNote}` : 'Hourly check-in snapshot verified.')
                                  setCheckinNote('')
                                  setActiveCheckinOrder(null)
                                }}
                              >
                                Submit Check-in Snapshot
                              </button>
                              <button className="btn btn-ghost" onClick={() => setActiveCheckinOrder(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="card-actions" style={{ marginTop: 12 }}>
                            <button
                              className="btn btn-ghost"
                              onClick={() => setActiveCheckinOrder(order.id)}
                            >
                              📸 Send Hourly Check-in
                            </button>
                            <button
                              className="btn btn-primary"
                              onClick={() => advanceOrderStatus(order.id, 'Dispatched', 'Writing completed. Handed to Borzo courier partner with sealed tamper-evident envelope.')}
                            >
                              📦 Mark Finished &amp; Dispatch
                            </button>
                            <Link to={`/track/${order.id}`} className="btn btn-ghost">
                              Live Tracker
                            </Link>
                          </div>
                        )}
                      </div>
                    )}

                    {order.status === 'Dispatched' && (
                      <div className="dispatched-box">
                        <p style={{ fontSize: 14 }}>
                          Courier is transporting package to campus gate. <strong>Delivery OTP: {order.otp}</strong>
                        </p>
                        <div className="card-actions" style={{ marginTop: 12 }}>
                          <button
                            className="btn btn-primary"
                            onClick={() => advanceOrderStatus(order.id, 'Delivered', 'Gate delivery confirmed by courier photo & OTP match.')}
                          >
                            Confirm Gate Delivery
                          </button>
                          <Link to={`/track/${order.id}`} className="btn btn-ghost">
                            Audit Trail
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Nearby Campus Order Pool */}
        <div className="dash-column">
          <div className="column-header">
            <h2>Nearby Campus Orders ({pendingOrders.length})</h2>
            <span className="muted-tag">Within 3 km of {profile.college.split(' ')[0]}</span>
          </div>

          <div className="nearby-orders-list">
            {pendingOrders.length === 0 ? (
              <div className="card empty-state">
                <p>No new orders pending right now. Check back soon!</p>
              </div>
            ) : (
              pendingOrders.map(order => (
                <div key={order.id} className="card nearby-order-card">
                  <div className="nearby-card-header">
                    <div>
                      <span className="distance-chip">📍 {order.distanceKm} km away</span>
                      <h3 style={{ marginTop: 8, fontSize: 17 }}>{order.title}</h3>
                      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                        {order.subject} · {order.customerName}
                      </p>
                    </div>
                    <div className="payout-tag">
                      <span className="payout-title">You Earn</span>
                      <span className="payout-num">{inr(order.scribePayout)}</span>
                    </div>
                  </div>

                  <div className="nearby-card-specs">
                    <div><strong>Pages:</strong> {order.pages} (~{order.words} words)</div>
                    <div><strong>Pen:</strong> {order.penStyle}</div>
                    <div><strong>Deadline:</strong> {order.deadlineAt}</div>
                    <div><strong>Add-ons:</strong> {order.addons.join(', ') || 'Standard text'}</div>
                  </div>

                  <div className="nearby-card-footer">
                    <button
                      className="btn btn-primary full"
                      onClick={() => acceptOrder(order.id)}
                    >
                      Accept Order ({inr(order.scribePayout)})
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Quick link to Onboarding & Sample Card */}
          <div className="card scribe-profile-summary" style={{ marginTop: 24 }}>
            <h3>Scribe Credential Card</h3>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
              Your handwriting card is published to customers. Keep UPI VPA updated for instant escrow releases.
            </p>
            <div className="sample-card-preview" style={{ marginTop: 12 }}>
              <p className="sample-scribble font-caveat">"{profile.sampleText}"</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 8 }}>
                <span>UPI: <strong>{profile.upiVpa}</strong></span>
                <Link to="/scribe/onboarding" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                  Edit Profile ➔
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
