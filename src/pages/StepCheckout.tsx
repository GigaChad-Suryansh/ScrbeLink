/**
 * StepCheckout.tsx  –  Step 4 of the order wizard
 * Displays a full order summary, collects a mock UPI ID, and "places" the order.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrder, MOCK_SCRIBES } from '../lib/orderStore'
import { quote, inr, formatDuration } from '../lib/pricing'

function genOrderId(): string {
  return 'SL-' + Math.random().toString(36).slice(2, 8).toUpperCase()
}

export default function StepCheckout() {
  const { state, dispatch } = useOrder()
  const nav = useNavigate()

  const [upi, setUpi] = useState(state.upiId)
  const [paying, setPaying] = useState(false)
  const [upiError, setUpiError] = useState('')

  const scribe = MOCK_SCRIBES.find(s => s.id === state.scribeId)

  const q = quote({
    words: state.words,
    simpleDrawings: state.simpleDrawings,
    complexDrawings: state.complexDrawings,
    graphs: state.graphs,
    customTemplate: state.customTemplate,
  })

  const penLabels: Record<string, string> = {
    ballpoint: 'Ballpoint',
    gel: 'Gel',
    fountain: 'Fountain',
  }

  function validateUpi(v: string) {
    // UPI VPA pattern: localpart@handle  (permissive)
    return /^[\w.\-+]+@[\w]+$/.test(v.trim())
  }

  async function onPay() {
    dispatch({ type: 'SET_UPI', upiId: upi })
    if (!validateUpi(upi)) {
      setUpiError('Enter a valid UPI ID, e.g. yourname@upi')
      return
    }
    setUpiError('')
    setPaying(true)
    // Simulate network delay (mock)
    await new Promise(r => setTimeout(r, 1800))
    const orderId = genOrderId()
    dispatch({ type: 'PLACE_ORDER', orderId })
    nav('/order/confirmation')
  }

  function onBack() {
    nav('/order/scribe')
  }

  return (
    <div className="wizard-step">
      <p className="eyebrow">Step 4 of 4</p>
      <h2 className="section-title">Review &amp; pay</h2>

      <div className="checkout-grid">
        {/* ── Left: summary ── */}
        <div>
          {/* Document */}
          <div className="summary-section card">
            <h3 className="summary-heading">Document</h3>
            <div className="summary-row">
              <span>File</span><strong>{state.doc?.name ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Words</span><strong>{state.words.toLocaleString()}</strong>
            </div>
            <div className="summary-row">
              <span>Billable pages</span><strong>{q.pages}</strong>
            </div>
          </div>

          {/* Add-ons */}
          <div className="summary-section card" style={{ marginTop: 12 }}>
            <h3 className="summary-heading">Add-ons</h3>
            {state.simpleDrawings > 0 && (
              <div className="summary-row">
                <span>Simple drawings</span><strong>×{state.simpleDrawings}</strong>
              </div>
            )}
            {state.complexDrawings > 0 && (
              <div className="summary-row">
                <span>Complex drawings</span><strong>×{state.complexDrawings}</strong>
              </div>
            )}
            {state.graphs > 0 && (
              <div className="summary-row">
                <span>Calibrated graphs</span><strong>×{state.graphs}</strong>
              </div>
            )}
            {state.customTemplate && (
              <div className="summary-row">
                <span>Custom template</span><strong>Yes</strong>
              </div>
            )}
            <div className="summary-row">
              <span>Pen</span>
              <strong>{penLabels[state.pen]} · {state.ink === 'blue' ? 'Blue' : 'Black'} ink</strong>
            </div>
          </div>

          {/* Scribe */}
          {scribe && (
            <div className="summary-section card" style={{ marginTop: 12 }}>
              <h3 className="summary-heading">Scribe</h3>
              <div className="summary-row">
                <span>Name</span><strong>{scribe.name}</strong>
              </div>
              <div className="summary-row">
                <span>ID</span><strong>#{scribe.tag}</strong>
              </div>
              <div className="summary-row">
                <span>Specialty</span><strong>{scribe.specialty}</strong>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: price + pay ── */}
        <div className="checkout-pay-col">
          {/* Price breakdown */}
          <div className="calc-quote card" style={{ position: 'sticky', top: 80 }}>
            <h3>Price breakdown</h3>
            <ul className="lines">
              {q.items.map(item => (
                <li key={item.label}>
                  <span>
                    <span style={{ display: 'block', fontWeight: 600 }}>{item.label}</span>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>{item.detail}</span>
                  </span>
                  <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{inr(item.customer)}</span>
                </li>
              ))}
            </ul>
            <div className="total">
              <span>Total</span>
              <strong>{inr(q.customerTotal)}</strong>
            </div>
            <p className="eta">
              ⏱ Estimated turnaround: {formatDuration(q.turnaroundHours)}
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              Payment held in escrow until order is delivered.
            </p>

            {/* UPI input */}
            <div className="field" style={{ marginBottom: 8 }}>
              <label htmlFor="upi-input" style={{ fontWeight: 600, fontSize: 14 }}>
                UPI ID (mock payment)
              </label>
              <input
                id="upi-input"
                type="text"
                value={upi}
                onChange={e => { setUpi(e.target.value); setUpiError('') }}
                placeholder="yourname@upi"
                disabled={paying}
              />
              {upiError && (
                <p style={{ color: 'var(--warn)', fontSize: 13 }}>{upiError}</p>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              This is a demo — no real payment is processed.
            </p>

            <button
              className="btn btn-primary full"
              onClick={onPay}
              disabled={paying || !upi}
              id="pay-btn"
              style={{ fontSize: 16 }}
            >
              {paying ? '⏳ Processing…' : `Pay ${inr(q.customerTotal)}`}
            </button>
          </div>
        </div>
      </div>

      <div className="wizard-nav" style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onBack} disabled={paying} id="checkout-back-btn">
          ← Back
        </button>
        <span />
      </div>
    </div>
  )
}
