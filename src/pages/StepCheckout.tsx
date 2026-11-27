/**
 * StepCheckout.tsx  –  Step 4 of the order wizard (Phase 5 Enhanced)
 * Integrates UPI test-mode payment gateway:
 * - Displays UPI QR code simulation & VPA Intent
 * - Validates VPA and tracks gateway confirmation
 * - Enforces escrow lock upon successful payment
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icons'
import { useOrder } from '../lib/orderStore'
import { quote, inr, formatDuration } from '../lib/pricing'
import type { UpiPaymentIntent } from '../backend/paymentGateway'
import { getPendingNotes } from '../lib/pendingFile'
import { api } from '../lib/api'
import GatePicker from '../components/GatePicker'
import { CANCELLATION_POLICY } from '../shared/refunds'
import { payWithRazorpay } from '../lib/razorpayCheckout'

export default function StepCheckout() {
  const { state, dispatch } = useOrder()
  const nav = useNavigate()

  const [upi, setUpi] = useState(state.upiId || 'student@okaxis')
  const [paymentIntent, setPaymentIntent] = useState<UpiPaymentIntent | null>(null)
  const [paying, setPaying] = useState(false)
  const [upiError, setUpiError] = useState('')
  const [gateId, setGateId] = useState<string | null>(null)
  const [provider, setProvider] = useState<'test' | 'razorpay'>('test')
  /** Kept so a customer who closes the payment window can retry without creating a second order. */
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null)

  /** Referral credit waiting to be used, and whether this customer can still enter a friend's code. */
  const [credit, setCredit] = useState(0)
  const [canApplyCode, setCanApplyCode] = useState(false)
  const [code, setCode] = useState('')
  const [codeMsg, setCodeMsg] = useState('')
  /** What the server actually charges for the draft order (after any credit). */
  const [serverTotal, setServerTotal] = useState<number | null>(null)

  useEffect(() => {
    api<{ provider: 'test' | 'razorpay' }>('GET', '/api/payment/config', { as: 'customer' })
      .then((c) => setProvider(c.provider))
      .catch(() => undefined)
    loadReferral()
  }, [])

  function loadReferral() {
    api<{ referral: { credit: number; canApplyCode: boolean } }>('GET', '/api/referrals/me', { as: 'customer' })
      .then((r) => {
        setCredit(r.referral.credit)
        setCanApplyCode(r.referral.canApplyCode)
      })
      .catch(() => undefined)
  }

  async function onApplyCode() {
    setCodeMsg('')
    try {
      await api('POST', '/api/referrals/apply', { as: 'customer', body: { code } })
      setCodeMsg('Code applied. ₹50 off this order.')
      setCode('')
      loadReferral()
    } catch (e) {
      setCodeMsg((e as Error).message)
    }
  }

  const q = quote({
    words: state.words,
    simpleDrawings: state.simpleDrawings,
    complexDrawings: state.complexDrawings,
    graphs: state.graphs,
    customTemplate: state.customTemplate,
  })
  // The server applies credit only while the customer still pays at least the scribe's share.
  const discount = credit > 0 && q.customerTotal - credit >= q.scribeTotal ? credit : 0
  const payable = serverTotal ?? q.customerTotal - discount

  const penLabels: Record<string, string> = {
    ballpoint: 'Ballpoint',
    gel: 'Gel',
    fountain: 'Fountain',
  }

  function validateUpi(v: string) {
    return /^[\w.\-+]+@[\w]+$/.test(v.trim())
  }

  async function onInitiatePayment() {
    if (!gateId) {
      setUpiError('Choose where to deliver your pages first.')
      return
    }
    if (provider === 'test' && !validateUpi(upi)) {
      setUpiError('Enter a valid UPI ID (e.g. name@okhdfcbank or name@paytm)')
      return
    }
    setUpiError('')
    setPaying(true)
    try {
      // 0. Send the notes so the scribe can read them once they accept the order.
      const notes = draftOrderId ? null : getPendingNotes()
      let notesFileId: string | undefined
      if (notes) {
        const up = await api<{ fileId: string }>('POST', '/api/uploads/notes', { as: 'customer', raw: notes, headers: { 'x-file-name': encodeURIComponent(notes.name) } })
        notesFileId = up.fileId
      }
      // 1. The server creates the order and prices it itself.
      const created = draftOrderId ? { order: { id: draftOrderId, customerTotal: payable } } : await api<{ order: { id: string; customerTotal: number } }>('POST', '/api/orders/create', {
        as: 'customer',
        body: {
          title: (state.doc?.name ?? 'Untitled document').replace(/\.[^.]+$/, ''),
          subject: 'General',
          words: state.words,
          simpleDrawings: state.simpleDrawings,
          complexDrawings: state.complexDrawings,
          graphs: state.graphs,
          customTemplate: state.customTemplate,
          penStyle: `${penLabels[state.pen]} · ${state.ink === 'blue' ? 'Blue' : 'Black'}`,
          preferredScribeId: state.scribeId ?? undefined,
          notesFileId,
          gateId,
        },
      })
      const orderId = created.order.id
      const amount = Number(created.order.customerTotal)
      setDraftOrderId(orderId)
      setServerTotal(amount)

      if (provider === 'razorpay') {
        const rz = await api<{ paymentId: string; keyId: string; rzpOrderId: string; amount: number }>('POST', '/api/payment/razorpay/order', { as: 'customer', body: { orderId } })
        const paid = await payWithRazorpay({ keyId: rz.keyId, rzpOrderId: rz.rzpOrderId, amountRupees: rz.amount, description: `Order ${orderId}` })
        await api('POST', '/api/payment/razorpay/verify', { as: 'customer', body: { paymentId: rz.paymentId, razorpayPaymentId: paid.razorpay_payment_id, razorpaySignature: paid.razorpay_signature } })
        dispatch({ type: 'PLACE_ORDER', orderId })
        nav('/order/confirmation')
        return
      }

      // 2. Start the UPI payment for exactly that amount.
      const started = await api<{ payment: UpiPaymentIntent }>('POST', '/api/payment/upi/initiate', {
        as: 'customer',
        body: { orderId, amount, payerVpa: upi.trim() },
      })
      setPaymentIntent(started.payment)

      // 3. Test gateway: the payer "approves" after a moment. Escrow locks and the order becomes Paid.
      await new Promise((r) => setTimeout(r, 1800))
      await api('POST', '/api/payment/upi/verify', { as: 'customer', body: { paymentId: started.payment.paymentId } })

      dispatch({ type: 'SET_UPI', upiId: upi })
      dispatch({ type: 'PLACE_ORDER', orderId })
      nav('/order/confirmation')
    } catch (e) {
      setPaymentIntent(null)
      setUpiError((e as Error).message)
    } finally {
      setPaying(false)
    }
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
          <GatePicker value={gateId} onChange={setGateId} />

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
          <div className="summary-section card" style={{ marginTop: 12 }}>
            <h3 className="summary-heading">Scribe</h3>
            <div className="summary-row">
              <span>Chosen</span><strong>{state.scribeName ?? 'Any approved scribe'}</strong>
            </div>
          </div>
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
            {discount > 0 && (
              <ul className="lines">
                <li>
                  <span style={{ fontWeight: 600 }}>Referral credit</span>
                  <span style={{ whiteSpace: 'nowrap', fontWeight: 600, color: '#166534' }}>-{inr(discount)}</span>
                </li>
              </ul>
            )}
            <div className="total">
              <span>Total</span>
              <strong>{inr(payable)}</strong>
            </div>
            <p className="eta">
              <Icon name="clock" size={14} /> Turnaround deadline: {formatDuration(q.turnaroundHours)}
            </p>

            {canApplyCode && !draftOrderId && (
              <div className="field">
                <label htmlFor="referral-code">Have a friend's referral code?</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input id="referral-code" type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SLXXXXXX" maxLength={20} style={{ flex: 1 }} />
                  <button type="button" className="btn btn-ghost" onClick={onApplyCode} disabled={code.trim().length < 4} id="referral-apply-btn">Apply</button>
                </div>
              </div>
            )}
            {codeMsg && <p style={{ fontSize: 13, margin: '0 0 12px' }} role="status">{codeMsg}</p>}

            <div style={{ background: '#f0fdf4', padding: '10px 12px', borderRadius: 8, border: '1px solid #bbf7d0', marginBottom: 16 }}>
              <p style={{ fontSize: 12.5, color: '#166534', margin: 0 }}>
                <strong>Escrow protected:</strong> Held in nodal escrow. Automatically transferred to scribe 24 hours post-delivery.
              </p>
            </div>

            <details style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
              <summary style={{ cursor: 'pointer' }}>Cancellation and refunds</summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {CANCELLATION_POLICY.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </details>

            {/* UPI Test Gateway Form */}
            {!paymentIntent ? (
              <>
                {provider === 'test' && (<>
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
                </>)}

                <button
                  className="btn btn-primary full"
                  onClick={onInitiatePayment}
                  disabled={paying || (provider === 'test' && !upi) || !gateId}
                  id="pay-btn"
                  style={{ fontSize: 16 }}
                >
                  Pay {inr(payable)}{provider === 'test' ? ' with UPI' : ''}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ marginBottom: 8, color: 'var(--muted)' }}><Icon name="clock" size={32} /></div>
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
          Back
        </button>
        <span />
      </div>
    </div>
  )
}
