/**
 * OrderTracker.tsx
 * Customer Order Tracker following the 5-stage state machine:
 * Paid -> Accepted -> Writing -> Dispatched -> Delivered
 */

import Icon from '../components/Icons'
import { CANCELLATION_POLICY, REFUND_REASON_TEXT, customerCanCancel, type RefundReason } from '../shared/refunds'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useScribePortal } from '../lib/scribeStore'
import type { OrderStatus } from '../lib/scribeStore'
import { inr } from '../lib/pricing'
import { downloadFile } from '../lib/api'

const STAGES: { key: OrderStatus; label: string; desc: string }[] = [
  { key: 'Paid', label: '1. Paid', desc: 'Held in Escrow' },
  { key: 'Accepted', label: '2. Accepted', desc: '30-min Intake Passed' },
  { key: 'Writing', label: '3. Writing', desc: 'Hourly Check-ins' },
  { key: 'Dispatched', label: '4. Dispatched', desc: 'Courier In Transit' },
  { key: 'Delivered', label: '5. Delivered', desc: 'Gate Drop Confirmed' },
]

export default function OrderTracker() {
  const { orderId } = useParams<{ orderId: string }>()
  const { orders, loading, loadError, cancelOrder } = useScribePortal()
  const [picked, setPicked] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const order = orders.find(o => o.id === (picked ?? orderId)) ?? (orderId ? undefined : orders[0])

  if (loading) return <p className="section-sub">Loading your orders…</p>
  if (!order) {
    return (
      <div className="card empty-state" style={{ padding: 32 }}>
        {loadError && <p className="alert alert--warn" role="alert">{loadError}</p>}
        <h2 style={{ fontSize: 22 }}>{orderId ? `Order ${orderId} was not found` : 'No orders yet'}</h2>
        <p className="section-sub" style={{ margin: '8px 0 18px' }}>
          {orderId ? 'It may belong to a different account.' : 'Your orders will show up here as soon as you place one.'}
        </p>
        <Link to="/order/upload" className="btn btn-primary">Place an order</Link>
      </div>
    )
  }

  const currentStageIdx = STAGES.findIndex(s => s.key === order.status)

  return (
    <div className="tracker-page">
      <div className="tracker-top">
        <div>
          <span className="eyebrow">Customer Live Tracking</span>
          <h1 className="section-title">Order Status: #{order.id}</h1>
          <p className="section-sub">
            Follow your physical note transcription step-by-step through our verified escrow workflow.
          </p>
        </div>

        {orders.length > 1 && <div className="order-switcher">
          <label htmlFor="order-select" style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
            Your orders:
          </label>
          <select
            id="order-select"
            value={order.id}
            onChange={e => setPicked(e.target.value)}
            className="select-input"
          >
            {orders.map(o => (
              <option key={o.id} value={o.id}>
                {o.id} — {o.status} ({o.title.slice(0, 24)}...)
              </option>
            ))}
          </select>
        </div>}
      </div>

      {/* 5-Step Progress Stepper */}
      <div className="card tracker-stepper-card">
        <div className="stepper-track">
          {STAGES.map((s, idx) => {
            const isCompleted = idx < currentStageIdx
            const isCurrent = idx === currentStageIdx
            return (
              <div
                key={s.key}
                className={`stepper-node ${isCompleted ? 'node--done' : ''} ${isCurrent ? 'node--active' : ''}`}
              >
                <div className="node-icon">
                  {isCompleted ? <Icon name="check" size={14} /> : idx + 1}
                </div>
                <div className="node-info">
                  <div className="node-title">{s.label}</div>
                  <div className="node-desc">{s.desc}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {order.refund && (
        <div className="card" style={{ padding: 20, marginBottom: 16, borderColor: 'var(--ok)' }} id="refund-card">
          <strong>{order.refund.status === 'PROCESSED' ? `Refund of ${inr(order.refund.amount)} sent` : `Refund of ${inr(order.refund.amount)} on its way`}</strong>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--muted)' }}>
            {REFUND_REASON_TEXT[order.refund.reason as RefundReason] ?? 'Refund issued'}. It returns to the account you paid from, usually within 5 to 7 working days.
          </p>
        </div>
      )}

      {order.status !== 'Draft' && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            className="btn btn-ghost sm"
            id="invoice-btn"
            onClick={async () => {
              try {
                await downloadFile(`/api/orders/${order.id}/invoice`, 'customer', `invoice-${order.id}.pdf`)
              } catch {
                setCancelError('Could not open the invoice. Try again.')
              }
            }}
          >
            Download invoice
          </button>
          {cancelError && !confirmCancel && <div className="alert alert--warn" role="alert" style={{ marginTop: 8 }}>{cancelError}</div>}
        </div>
      )}

      {customerCanCancel(order.status) && order.status !== 'Draft' && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }} id="cancel-card">
          {!confirmCancel ? (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(true)}>Cancel this order</button>
          ) : (
            <>
              <strong>Cancel order #{order.id}?</strong>
              <ul style={{ margin: '8px 0 12px', paddingLeft: 18, fontSize: 14, color: 'var(--muted)' }}>
                {CANCELLATION_POLICY.slice(0, 1).concat(CANCELLATION_POLICY.slice(3)).map((line) => <li key={line}>{line}</li>)}
              </ul>
              {cancelError && <div className="alert alert--warn" role="alert">{cancelError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary" id="confirm-cancel-btn" onClick={async () => {
                  const error = await cancelOrder(order.id)
                  if (error) setCancelError(error)
                  else setConfirmCancel(false)
                }}>Yes, cancel and refund me</button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(false)}>Keep my order</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Main Details Grid */}
      <div className="tracker-grid">
        {/* Left Column: Live Status & Timeline */}
        <div className="tracker-main">
          {/* Status highlight callout */}
          <div className="card status-callout">
            <div className="callout-header">
              <span className={`status-pill pill--${order.status.toLowerCase()}`}>
                ● {order.status}
              </span>
              <span className="deadline-badge">
                Deadline: {order.deadlineAt}
              </span>
            </div>
            {order.deliverTo && <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--muted)' }}>Delivering to {order.deliverTo}</p>}

            <h3 style={{ marginTop: 12, fontSize: 20 }}>{order.title}</h3>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
              Assigned Scribe: <strong>{order.scribeName || 'Matching verified scribe in your campus…'}</strong>
            </p>

            {order.status === 'Writing' && order.nextCheckInDueAt && (
              <div className="checkin-alert">
                <span>Rush protection is on. Next scribe check-in due in <strong>{order.nextCheckInDueAt}</strong></span>
              </div>
            )}

            {order.status === 'Dispatched' && order.otp && (
              <div className="otp-alert">
                <span>On its way. Share this delivery code <strong>{order.otp}</strong> with delivery person at your gate.</span>
              </div>
            )}

            {order.status === 'Delivered' && (
              <div className="delivered-alert">
                <span>Notes handed over at the college gate. Escrow will automatically release to the scribe in 24 hours if no dispute is opened. <Link to={`/dispute/${order.id}`}><strong>Report a problem</strong></Link></span>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="card timeline-card">
            <h3 style={{ fontSize: 17, marginBottom: 16 }}>Audit Trail &amp; Verification Events</h3>
            <div className="timeline-list">
              {order.timeline.map((event, i) => (
                <div key={i} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-content">
                    <div className="timeline-meta">
                      <strong>{event.status}</strong>
                      <span className="timeline-time">{event.timestamp}</span>
                    </div>
                    <p className="timeline-note">{event.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Order Specs & Summary */}
        <div className="tracker-sidebar">
          <div className="card spec-card">
            <h3 style={{ fontSize: 16, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>
              Order Specification
            </h3>
            <div className="spec-row">
              <span>Subject</span>
              <strong>{order.subject}</strong>
            </div>
            <div className="spec-row">
              <span>Volume</span>
              <strong>{order.pages} pages ({order.words.toLocaleString()} words)</strong>
            </div>
            <div className="spec-row">
              <span>Pen &amp; Ink</span>
              <strong>{order.penStyle}</strong>
            </div>
            <div className="spec-row">
              <span>Add-ons</span>
              <strong>{order.addons.join(', ') || 'None'}</strong>
            </div>
            <div className="spec-row">
              <span>{order.status === 'Cancelled' ? 'Amount paid' : 'Held in escrow'}</span>
              <strong style={{ color: 'var(--brand)', fontSize: 18 }}>{inr(order.customerPaid)}</strong>
            </div>
            <div className="spec-row">
              <span>Security</span>
              <strong style={{ color: 'var(--ok)' }}>Anti-cheat protected</strong>
            </div>
          </div>

          <div className="card help-card">
            <h4>Need support?</h4>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              Dispute windows open upon gate arrival. Always take an unboxing video before breaking the envelope seal.
            </p>
            <Link to="/" className="btn btn-ghost full" style={{ marginTop: 12, textAlign: 'center' }}>
              Return Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
