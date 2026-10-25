/**
 * ScribeEarnings.tsx
 * Earnings and Payout View for Scribes:
 * - Wallet balance, Pending escrow, Lifetime earnings
 * - Instant UPI payout withdrawal simulator
 * - Payout audit log & transaction history (escrow states)
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useScribePortal } from '../lib/scribeStore'
import { inr } from '../lib/pricing'

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
          <span className="eyebrow">Financial Settlement</span>
          <h1 className="section-title">Earnings &amp; UPI Payouts</h1>
          <p className="section-sub">
            All customer payments are locked into bank-level escrow and released directly to your UPI ID 24 hours post-delivery.
          </p>
        </div>

        <Link to="/scribe/dashboard" className="btn btn-ghost" style={{ alignSelf: 'center' }}>
          ← Back to Dashboard
        </Link>
      </div>

      {/* Financial Metrics Cards */}
      <div className="metrics-grid">
        <div className="card metric-card">
          <div className="metric-label">Ready for Payout</div>
          <div className="metric-num metric-num--brand">{inr(profile.walletBalance)}</div>
          <p className="metric-note">Cleared from 24h dispute window</p>
          <button
            className="btn btn-primary full"
            style={{ marginTop: 16 }}
            disabled={profile.walletBalance <= 0 || withdrawing}
            onClick={handleWithdrawal}
            id="withdraw-btn"
          >
            {withdrawing ? 'Transferring to UPI…' : profile.upiVpa ? `Withdraw to ${profile.upiVpa}` : 'Add a UPI ID to withdraw'}
          </button>
        </div>

        <div className="card metric-card">
          <div className="metric-label">Locked in Escrow</div>
          <div className="metric-num metric-num--warn">{inr(profile.pendingEscrow)}</div>
          <p className="metric-note">Awaiting transit &amp; gate-drop signoff</p>
          <div className="escrow-badge" style={{ marginTop: 22 }}>
            🛡 Protected by ScribeLink Escrow
          </div>
        </div>

        <div className="card metric-card">
          <div className="metric-label">Lifetime Earned</div>
          <div className="metric-num">{inr(profile.lifetimeEarnings)}</div>
          <p className="metric-note">Total across {profile.totalOrders} completed manuscripts</p>
          <div style={{ marginTop: 18, fontSize: 13, color: 'var(--muted)' }}>
            Average: ~{inr(profile.lifetimeEarnings / (profile.totalOrders || 1))} / order
          </div>
        </div>
      </div>

      {paidOut > 0 && (
        <div className="alert alert--ok" style={{ marginTop: 20 }}>
          ✓ {inr(paidOut)} recorded as sent to <strong>{profile.upiVpa}</strong>.
        </div>
      )}
      {error && <div className="alert alert--warn" role="alert" style={{ marginTop: 20 }}>{error}</div>}

      {/* Payout Transactions History Table */}
      <div className="card payouts-table-card" style={{ marginTop: 28 }}>
        <div className="table-header">
          <h3>Payout &amp; Escrow Ledger</h3>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Automated 24-hour cycle</span>
        </div>

        <div className="table-responsive">
          <table className="payout-table">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Order Ref</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Timestamp</th>
                <th>Settlement UPI</th>
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
    </div>
  )
}
