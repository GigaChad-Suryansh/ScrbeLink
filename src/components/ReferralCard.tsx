/**
 * components/ReferralCard.tsx
 * Phase 20: a customer's referral code and credit. ₹50 off for a friend's first order,
 * ₹50 credit back once that order is delivered.
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { inr } from '../lib/pricing'
import Icon from './Icons'

interface Summary { code: string; credit: number; invited: number; rewarded: number }

export default function ReferralCard() {
  const [r, setR] = useState<Summary | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api<{ referral: Summary }>('GET', '/api/referrals/me', { as: 'customer' })
      .then((x) => setR(x.referral))
      .catch(() => undefined)
  }, [])

  if (!r) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(r!.code)
      setCopied(true)
    } catch { /* clipboard blocked: the code is visible anyway */ }
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 20 }}>
      <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="gift" size={18} /> Invite a friend</h3>
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 12px' }}>
        Your friend gets ₹50 off their first order. You get ₹50 credit when it is delivered.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, padding: '6px 12px', border: '1px dashed var(--line)', borderRadius: 8 }}>{r.code}</code>
        <button type="button" className="btn btn-ghost sm" onClick={copy}>{copied ? 'Copied' : 'Copy code'}</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '12px 0 0' }}>
        {r.invited} invited · {r.rewarded} rewarded · Credit available: <strong>{inr(r.credit)}</strong>
        {r.credit > 0 && ' (used automatically on your next order)'}
      </p>
    </div>
  )
}
