/**
 * StepCheckout.tsx  –  Step 4 of the order wizard (Phase 5 Enhanced)
 * Integrates UPI test-mode payment gateway:
 * - Displays UPI QR code simulation & VPA Intent
 * - Validates VPA and tracks gateway confirmation
 * - Enforces escrow lock upon successful payment
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrder, MOCK_SCRIBES } from '../lib/orderStore'
import { quote, inr, formatDuration } from '../lib/pricing'
import { createUpiPaymentIntent, verifyUpiPayment, type UpiPaymentIntent } from '../backend/paymentGateway'
import { useScribePortal, type TrackableOrder } from '../lib/scribeStore'
import { randomDigits, randomToken } from '../shared/random'

function genOrderId(): string {
  return 'SL-' + randomToken(3)
}

export default function StepCheckout() {
  const { state, dispatch } = useOrder()
  const nav = useNavigate()
  const { addOrder } = useScribePortal()

  const [upi, setUpi] = useState(state.upiId || 'student@okaxis')
  const [paymentIntent, setPaymentIntent] = useState<UpiPaymentIntent | null>(null)
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

  /** The paid order, in the shape the tracker and the scribe dashboard read. */
  function buildTrackableOrder(orderId: string): TrackableOrder {
    const addons = [
      state.simpleDrawings > 0 && `${state.simpleDrawings} Simple Diagram${state.simpleDrawings > 1 ? 's' : ''}`,
      state.complexDrawings > 0 && `${state.complexDrawings} Complex Diagram${state.complexDrawings > 1 ? 's' : ''}`,
      state.graphs > 0 && `${state.graphs} Graph${state.graphs > 1 ? 's' : ''}`,
      state.customTemplate && 'College Template',
      q.pages >= 20 && 'Rigid Packaging',
    ].filter((a): a is string => Boolean(a))
    const due = new Date(Date.now() + q.turnaroundHours * 3600 * 1000)
    return {
      id: orderId,
      title: (state.doc?.name ?? 'Untitled document').replace(/\.[^.]+$/, ''),
      subject: scribe?.specialty ?? 'General',
      customerName: 'Anonymous student',
      status: 'Paid',
      pages: q.pages,
      words: state.words,
      addons,
      penStyle: `${penLabels[state.pen]} · ${state.ink === 'blue' ? 'Blue' : 'Black'}`,
      customerPaid: q.customerTotal,
      scribePayout: q.scribeTotal,
      distanceKm: 1,
      createdAt: 'Just now',
      deadlineAt: due.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      otp: randomDigits(6),
      timeline: [{ status: 'Paid', timestamp: 'Just now', note: 'Escrow payment confirmed. Waiting for a scribe to accept.' }],
    }
  }

  function validateUpi(v: string) {
    return /^[\w.\-+]+@[\w]+$/.test(v.trim())
  }

  async function onInitiatePayment() {
    if (!validateUpi(upi)) {
      setUpiError('Enter a valid UPI ID (e.g. name@okhdfcbank or name@paytm)')
      return
    }
    setUpiError('')
    setPaying(true)

    const orderId = genOrderId()
    // Generate UPI test intent
    const intent = createUpiPaymentIntent(orderId, q.customerTotal, upi)
    setPaymentIntent(intent)

    // Simulate user approving payment in their UPI app
    setTimeout(() => {
      verifyUpiPayment(intent.paymentId, true)
      dispatch({ type: 'SET_UPI', upiId: upi })
      dispatch({ type: 'PLACE_ORDER', orderId })
      addOrder(buildTrackableOrder(orderId))
      setPaying(false)
      nav('/order/confirmation')
    }, 2200)
  }

  function onBack() {
    nav('/order/scribe')
  }

  return (
    <div className="wizard-step">
      <p className="eyebrow">Step 4 of 4</p>
      <h2 className="section-title">Review &amp; pay (UPI Escrow)</h2>

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
              ⏱ Turnaround Deadline: {formatDuration(q.turnaroundHours)}
            </p>

            <div style={{ background: '#f0fdf4', padding: '10px 12px', borderRadius: 8, border: '1px solid #bbf7d0', marginBottom: 16 }}>
              <p style={{ fontSize: 12.5, color: '#166534', margin: 0 }}>
                🛡 <strong>Escrow Protected:</strong> Held in nodal escrow. Automatically transferred to scribe 24 hours post-delivery.
              </p>
            </div>

            {/* UPI Test Gateway Form */}
            {!paymentIntent ? (
              <>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label htmlFor="upi-input" style={{ fontWeight: 600, fontSize: 14 }}>
                    Your UPI VPA (Test Gateway)
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

                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {['@okaxis', '@okhdfcbank', '@paytm', '@ybl'].map(handle => (
                    <button
                      key={handle}
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => setUpi(upi.split('@')[0] + handle)}
                    >
                      {handle}
                    </button>
                  ))}
                </div>

                <button
                  className="btn btn-primary full"
                  onClick={onInitiatePayment}
                  disabled={paying || !upi}
                  id="pay-btn"
                  style={{ fontSize: 16 }}
                >
                  Pay {inr(q.customerTotal)} with UPI
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                <h4 style={{ margin: '0 0 6px' }}>UPI Intent Triggered</h4>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                  Approve notification on your UPI App or scanning the test intent...
                </p>
                <div style={{ margin: '14px auto', width: 140, height: 140, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', background: '#fff' }}>
                  <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>UPI TEST GATEWAY</span>
                </div>
                <span className="status-pill pill--writing">Processing Webhook...</span>
              </div>
            )}
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
