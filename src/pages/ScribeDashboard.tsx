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
import Icon from '../components/Icons'

export default function ScribeDashboard() {
  const { profile, orders, loading, loadError, acceptOrder, startWriting, submitCheckIn, dispatchOrder, confirmDelivery } = useScribePortal()
  const [checkinNote, setCheckinNote] = useState('')
  const [activeCheckinOrder, setActiveCheckinOrder] = useState<string | null>(null)

  const [otpEntry, setOtpEntry] = useState<Record<string, string>>({})
  const [otpError, setOtpError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const pendingOrders = orders.filter(o => o.status === 'Paid' || o.status === 'Reassigned')

  /** Runs an action, shows its error (if any), and blocks double clicks on that order. */
  async function act(orderId: string, fn: () => Promise<string | null>, onError: (m: string) => void = setActionError) {
    setBusyId(orderId)
    onError('')
    const err = await fn()
    setBusyId(null)
    if (err) onError(err)
    return !err
  }
  const activeOrders = orders.filter(o => ['Accepted', 'Writing', 'Dispatched'].includes(o.status))

  return (
    <div className="scribe-dashboard-page">
      {/* Scribe Top Banner */}
      <div className="scribe-dash-header">
        <div>
          <span className="eyebrow">Scribe portal</span>
          <h1 className="section-title">{profile.name ? `Hi, ${profile.name}` : 'Welcome to ScribeLink'}</h1>
          <p className="section-sub">
            {profile.registered
              ? <>{profile.college} · {profile.totalOrders} orders completed</>
              : 'Finish the steps below to start receiving orders.'}
          </p>
        </div>

        <div className="dash-quick-stats">
          <div className="dash-stat-box card">
            <span className="stat-label">In escrow</span>
            <span className="stat-val">{inr(profile.pendingEscrow)}</span>
          </div>
          <div className="dash-stat-box card">
            <span className="stat-label">Ready to withdraw</span>
            <span className="stat-val stat-val--ok">{inr(profile.walletBalance)}</span>
          </div>
          <Link to="/scribe/earnings" className="btn btn-primary" style={{ alignSelf: 'center' }}>
            View earnings
          </Link>
        </div>
      </div>

      {loadError && <div className="alert alert--warn" role="alert" style={{ marginBottom: 16 }}>{loadError}</div>}
      {actionError && <div className="alert alert--warn" role="alert" style={{ marginBottom: 16 }}>{actionError}</div>}
      {!loading && !profile.isSuspended && !(profile.registered && profile.isApproved) && (
        <div className="card setup-card">
          <h3>Get ready to take orders</h3>
          <ol className="setup-steps">
            <li className={profile.registered ? 'done' : 'current'}>
              <span className="setup-mark">{profile.registered ? <Icon name="check" size={18} /> : 1}</span>
              <div>
                <strong>Set up your profile</strong>
                <p>Add your name, college, UPI ID and a handwriting sample.</p>
                {!profile.registered && <Link to="/scribe/onboarding" className="btn btn-primary sm">Set up profile</Link>}
              </div>
            </li>
            <li className={profile.isApproved ? 'done' : profile.registered ? 'current' : ''}>
              <span className="setup-mark">{profile.isApproved ? <Icon name="check" size={18} /> : 2}</span>
              <div>
                <strong>Wait for approval</strong>
                <p>An admin checks your handwriting sample, usually within a day.</p>
              </div>
            </li>
            <li>
              <span className="setup-mark">3</span>
              <div>
                <strong>Accept orders</strong>
                <p>Approved scribes see available orders on this page.</p>
              </div>
            </li>
          </ol>
        </div>
      )}
      {profile.isSuspended && (
        <div className="alert alert--warn" role="alert" style={{ marginBottom: 16 }}>
          Your account is suspended after repeated missed check-ins. Contact support.
        </div>
      )}

      {/* Intake / Rush Check-in Alert Banner */}
      {activeOrders.some(o => o.status === 'Accepted' || o.status === 'Writing') && (
        <div className="urgent-action-card card">
          <div className="urgent-badge">Reminder</div>
          <div className="urgent-content">
            <h3>While you have an active order</h3>
            <p>
              Check the notes within 30 minutes of accepting. While writing, send a short progress update every hour or the order may be given to someone else.
            </p>
          </div>
        </div>
      )}

      {/* Main Grid: Active Orders & Nearby Marketplace */}
      <div className="scribe-dash-grid">
        {/* Left: Active In-Progress Tasks */}
        <div className="dash-column">
          <div className="column-header">
            <h2>Your orders ({activeOrders.length})</h2>
            
          </div>

          {activeOrders.length === 0 ? (
            <div className="card empty-state">
              <p>No orders in progress. Accept one from the available orders.</p>
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
                      <span className="spec-chip">{order.penStyle}</span>
                      {order.addons.map(a => (
                        <span key={a} className="spec-chip">{a}</span>
                      ))}
                    </div>

                    {/* Step-specific controls */}
                    {order.status === 'Accepted' && (
                      <div className="intake-inspection-box">
                        <div className="inspection-timer">
                          <strong>Check the notes first.</strong> You have until {order.intakeInspectionExpiresAt ?? 'the intake deadline'} to confirm or flag a problem.
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                          Review the customer's text. Ensure no illicit cover pages or mismatched diagram requirements.
                        </p>
                        <div className="card-actions" style={{ marginTop: 12 }}>
                          <button
                            className="btn btn-primary"
                            disabled={busyId === order.id}
                            onClick={() => act(order.id, () => startWriting(order.id))}
                          >
                            Confirm and start writing
                          </button>
                        </div>
                      </div>
                    )}

                    {order.status === 'Writing' && (
                      <div className="writing-checkin-box">
                        <div className="checkin-timer">
                          Next check-in due: <strong>{order.nextCheckInDueAt || 'within the hour'}</strong>
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
                                disabled={busyId === order.id}
                                onClick={async () => {
                                  if (await act(order.id, () => submitCheckIn(order.id, checkinNote))) {
                                    setCheckinNote('')
                                    setActiveCheckinOrder(null)
                                  }
                                }}
                              >
                                Submit update
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
                              Send progress update
                            </button>
                            <button
                              className="btn btn-primary"
                              disabled={busyId === order.id}
                              onClick={() => act(order.id, () => dispatchOrder(order.id))}
                            >
                              Finished, send for delivery
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {order.status === 'Dispatched' && (
                      <div className="dispatched-box">
                        <p style={{ fontSize: 14 }}>
                          Courier is transporting the package to the campus gate. At handover, the customer reads you the
                          <strong> 6-digit delivery code</strong> shown in their tracker. Enter it to complete delivery.
                        </p>
                        <div className="card-actions" style={{ marginTop: 12 }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="6-digit code"
                            aria-label="Delivery code from the customer"
                            value={otpEntry[order.id] ?? ''}
                            onChange={e => { setOtpEntry(prev => ({ ...prev, [order.id]: e.target.value.replace(/\D/g, '') })); setOtpError('') }}
                            style={{ width: 150 }}
                          />
                          <button
                            className="btn btn-primary"
                            disabled={(otpEntry[order.id] ?? '').length !== 6 || busyId === order.id}
                            onClick={() => act(order.id, () => confirmDelivery(order.id, otpEntry[order.id] ?? ''), setOtpError)}
                          >
                            Confirm delivery
                          </button>
                        </div>
                        {otpError && <p className="alert alert--warn" role="alert" style={{ marginTop: 8 }}>{otpError}</p>}
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
            <h2>Available orders ({pendingOrders.length})</h2>
            
          </div>

          <div className="nearby-orders-list">
            {pendingOrders.length === 0 ? (
              <div className="card empty-state">
                <p>No orders available right now. This page refreshes on its own.</p>
              </div>
            ) : (
              pendingOrders.map(order => (
                <div key={order.id} className="card nearby-order-card">
                  <div className="nearby-card-header">
                    <div>
                      <h3 style={{ fontSize: 17 }}>{order.title}</h3>
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
                      disabled={busyId === order.id}
                      onClick={() => act(order.id, () => acceptOrder(order.id))}
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
            <h3>Your handwriting card</h3>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
              Customers see this card when choosing a scribe.
            </p>
            <div className="sample-card-preview" style={{ marginTop: 12 }}>
              <p className="sample-scribble font-caveat">"{profile.sampleText || 'Add a handwriting sample in your profile.'}"</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 8 }}>
                <span>UPI ID: <strong>{profile.upiVpa || 'not set'}</strong></span>
                <Link to="/scribe/onboarding" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                  Edit profile
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
