/**
 * OrderConfirmation.tsx
 * Shown after a successful mock payment.  Displays the order ID and next steps.
 */

import { useNavigate, Link } from 'react-router-dom'
import { useOrder } from '../lib/orderStore'
import { inr } from '../lib/pricing'
import { quote } from '../lib/pricing'

export default function OrderConfirmation() {
  const { state, dispatch } = useOrder()
  const nav = useNavigate()

  if (!state.orderId) {
    // Guard: if someone lands here directly, redirect to upload
    nav('/order/upload', { replace: true })
    return null
  }

  const q = quote({
    words: state.words,
    simpleDrawings: state.simpleDrawings,
    complexDrawings: state.complexDrawings,
    graphs: state.graphs,
    customTemplate: state.customTemplate,
  })

  function onNewOrder() {
    dispatch({ type: 'RESET' })
    nav('/order/upload')
  }

  return (
    <div className="wizard-step confirm-page">
      <div className="confirm-icon" aria-hidden="true">🎉</div>
      <h2 className="section-title">Order placed!</h2>
      <p className="section-sub" style={{ marginBottom: 24 }}>
        Your order is now in the queue. A scribe will accept it shortly.
      </p>

      <div className="card confirm-card">
        <div className="summary-row">
          <span>Order ID</span>
          <strong className="order-id">{state.orderId}</strong>
        </div>
        <div className="summary-row">
          <span>Amount paid (escrow)</span>
          <strong>{inr(q.customerTotal)}</strong>
        </div>
        <div className="summary-row">
          <span>Pages</span>
          <strong>{q.pages}</strong>
        </div>
      </div>

      <div className="confirm-steps card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 16, fontSize: 17 }}>What happens next</h3>
        <ol className="confirm-list">
          <li>
            <strong>Accepted</strong> — A scribe accepts your order and starts a 30-minute inspection.
          </li>
          <li>
            <strong>Writing</strong> — Scribe completes the pages with hourly check-ins.
          </li>
          <li>
            <strong>Dispatched</strong> — Courier picks up; you get a gate-drop photo.
          </li>
          <li>
            <strong>Delivered</strong> — Confirm receipt. Escrow is released to the scribe within 24 hours.
          </li>
        </ol>
      </div>

      <div className="wizard-nav" style={{ marginTop: 28 }}>
        <button className="btn btn-ghost" onClick={() => nav('/')} id="confirm-home-btn">
          ← Back to home
        </button>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link className="btn btn-primary" to={`/track/${state.orderId}`} id="confirm-track-btn">
            Track this order
          </Link>
          <button className="btn btn-ghost" onClick={onNewOrder} id="confirm-new-btn">
            Place another order
          </button>
        </div>
      </div>
    </div>
  )
}
