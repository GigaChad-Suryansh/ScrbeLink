/**
 * ScribeEarnings.tsx
 * Earnings and Payout View for Scribes:
 * - Wallet balance, Pending escrow, Lifetime earnings
 * - Instant UPI payout withdrawal (Phase 16: RazorpayX or simulated)
 * - Payout audit log & transaction history (escrow states)
 * - Monthly earnings statement with TDS summary (Phase 16)
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useScribePortal } from '../lib/scribeStore'
import { inr } from '../lib/pricing'
import { api } from '../lib/api'

interface MonthStatement {
  month: string
  grossPaid: number
  tdsDeducted: number
  netPaid: number
  transactionCount: number
}

function MonthlyStatement() {
  const [rows, setRows] = useState<MonthStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ statement: MonthStatement[] }>('GET', '/api/scribe/statement', { as: 'scribe' })
      .then(r => setRows(r.statement))
      .catch(e => setErr((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading statement…</p>
  if (err) return <p role="alert" style={{ color: 'var(--warn)', fontSize: 13 }}>{err}</p>

  return (
    <div className="card payouts-table-card" style={{ marginTop: 28 }}>
      <div className="table-header"><h3>Monthly statement</h3></div>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--muted)', padding: '16px 0', fontSize: 13 }}>No completed payouts yet.</p>
      ) : (
        <div className="table-responsive">
          <table className="payout-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Gross paid</th>
                <th>TDS deducted</th>
                <th>Net received</th>
                <th>Transactions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.month}>
                  <td><strong>{r.month}</strong></td>
                  <td>{inr(r.grossPaid)}</td>
                  <td style={{ color: 'var(--warn)' }}>{r.tdsDeducted > 0 ? `-${inr(r.tdsDeducted)}` : '—'}</td>
                  <td><strong>{inr(r.netPaid)}</strong></td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{r.transactionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
        TDS at 10% is deducted on payouts above ₹30,000 in a financial year (April–March).
        A TDS certificate will be provided annually. Confirm with a CA before filing.
      </p>
    </div>
  )
}

export default function ScribeEarnings() {
  const { profile, payouts, withdraw } = useScribePortal()
  const [withdrawing, setWithdrawing] = useState(false)
  const [paidOut, setPaidOut] = useState(0)
  const [error, setError] = useState('')

  async function handleWithdrawal() {
    if (profile.walletBalance <= 0) return
    const amount = profile.walletBalance
    setWithdrawing(true)
    setError('')
    setPaidOut(0)
    const err = await withdraw()
    setWithdrawing(false)
    if (err) setError(err)
    else {
      setPaidOut(amount)
      setTimeout(() => setPaidOut(0), 6000)
    }
  }

  return (
    <div className="earnings-page">
      <div className="earnings-top">
        <div>
          <span className="eyebrow">Earnings</span>
          <h1 className="section-title">Your earnings</h1>
          <p className="section-sub">
            Customer payments are held until the notes are delivered. 24 hours later they become available to withdraw to your UPI ID.
          </p>
        </div>

        <Link to="/scribe/dashboard" className="btn btn-ghost" style={{ alignSelf: 'center' }}>
          Back to dashboard
        </Link>
      </div>

      {/* Financial Metrics Cards */}
      <div className="metrics-grid">
        <div className="card metric-card">
          <div className="metric-label">Ready to withdraw</div>
          <div className="metric-num metric-num--brand">{inr(profile.walletBalance)}</div>
          <p className="metric-note">Past the 24-hour dispute window</p>
          <button
            className="btn btn-primary full"
            style={{ marginTop: 16 }}
            disabled={profile.walletBalance <= 0 || withdrawing}
            onClick={handleWithdrawal}
            id="withdraw-btn"
          >
            {withdrawing ? 'Sending…' : profile.upiVpa ? `Withdraw to ${profile.upiVpa}` : 'Add a UPI ID to withdraw'}
          </button>
        </div>

        <div className="card metric-card">
          <div className="metric-label">Held until delivery</div>
          <div className="metric-num metric-num--warn">{inr(profile.pendingEscrow)}</div>
          <p className="metric-note">Released 24 hours after delivery</p>
          <div className="escrow-badge" style={{ marginTop: 22 }}>
            Payments are held safely until delivery
          </div>
        </div>

        <div className="card metric-card">
          <div className="metric-label">Total earned</div>
          <div className="metric-num">{inr(profile.lifetimeEarnings)}</div>
          <p className="metric-note">Total across {profile.totalOrders} completed manuscripts</p>
          <div style={{ marginTop: 18, fontSize: 13, color: 'var(--muted)' }}>
            Average: ~{inr(profile.lifetimeEarnings / (profile.totalOrders || 1))} / order
          </div>
        </div>
      </div>

      {paidOut > 0 && (
        <div className="alert alert--ok" style={{ marginTop: 20 }}>
          {inr(paidOut)} recorded as sent to <strong>{profile.upiVpa}</strong>.
        </div>
      )}
      {error && <div className="alert alert--warn" role="alert" style={{ marginTop: 20 }}>{error}</div>}

      {/* Payout Transactions History Table */}
      <div className="card payouts-table-card" style={{ marginTop: 28 }}>
        <div className="table-header">
          <h3>Payment history</h3>
          
        </div>

        <div className="table-responsive">
          <table className="payout-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Order</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th>Sent to</th>
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 && (
                <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No earnings yet. Accepted orders appear here as soon as they are in escrow.</td></tr>
              )}
              {payouts.map(tx => (
                <tr key={tx.id}>
                  <td><strong>{tx.id}</strong></td>
                  <td>{tx.orderId === '—' ? '—' : `#${tx.orderId}`}</td>
                  <td><strong style={{ color: 'var(--ink)' }}>{inr(tx.amount)}</strong></td>
                  <td>
                    <span className={`status-pill pill--${tx.status.toLowerCase().replace(' ', '-')}`}>
                      ● {tx.status}
                    </span>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{tx.date}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{tx.status === 'Transferred' ? profile.upiVpa : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <MonthlyStatement />
    </div>
  )
}
