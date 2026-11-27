/**
 * pages/HelpPage.tsx
 * Phase 20: plain answers to the questions customers and scribes ask most, with links to support.
 */

import { Link } from 'react-router-dom'
import Icon from '../components/Icons'
import { RATES } from '../lib/pricing'

const CUSTOMER: Array<[string, string]> = [
  ['How much does it cost?', `₹${RATES.perPage.customer} per handwritten page, with a minimum of ${RATES.minOrderPages} pages. Delivery to your campus gate is included. Diagrams, graphs and a college template cost extra and are shown before you pay.`],
  ['Where are my pages delivered?', 'To the campus gate or public pickup point you choose at checkout. A rider brings them and asks for your 6-digit delivery code, so only you can receive them.'],
  ['When is my money paid to the scribe?', 'Your payment is held by ScribeLink. It is released to the scribe 24 hours after delivery, unless you open a dispute in that time.'],
  ['Can I cancel?', 'Yes, until the scribe starts writing. See the refund policy for how much comes back at each stage.'],
  ['Something is wrong with my pages.', 'Open a dispute within 24 hours of delivery and attach your unboxing video. An admin reviews it and can refund you.'],
  ['How do referral codes work?', 'Share your code from the tracking page. Your friend gets ₹50 off their first order, and you get ₹50 credit once that order is delivered.'],
  ['Who sees my notes?', 'Only the scribe who accepts your order and ScribeLink admins. Scribes never see your name or phone number. Files are deleted 7 days after the order closes.'],
]

const SCRIBE: Array<[string, string]> = [
  ['How do I start?', 'Sign in as a scribe, fill in your handwriting profile, and upload your college ID, a selfie and your PAN. An admin checks them before you can accept orders.'],
  ['How much do I earn?', `₹${RATES.perPage.scribe} per page. Referral discounts never reduce your pay.`],
  ['When do I get paid?', 'Earnings become withdrawable 24 hours after delivery. Withdrawals go to your UPI ID, and you can see each payout\'s status on the Earnings page.'],
  ['Can I take a break?', 'Yes. Set how many pages you can take today, or turn on vacation mode from your dashboard.'],
]

function Faq({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="card" style={{ padding: 8 }}>
      {items.map(([q, a]) => (
        <details key={q} style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{q}</summary>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.6 }}>{a}</p>
        </details>
      ))}
    </div>
  )
}

export default function HelpPage() {
  return (
    <div className="container" style={{ maxWidth: 820, padding: '40px 16px 64px' }}>
      <p className="eyebrow"><Icon name="help" size={14} /> Help</p>
      <h1 className="section-title">How can we help?</h1>

      <h2 style={{ fontSize: 20, margin: '28px 0 12px' }}>For customers</h2>
      <Faq items={CUSTOMER} />

      <h2 style={{ fontSize: 20, margin: '28px 0 12px' }}>For scribes</h2>
      <Faq items={SCRIBE} />

      <div className="card" style={{ padding: 20, marginTop: 28 }}>
        <h3 style={{ marginTop: 0 }}>Still stuck?</h3>
        <p style={{ color: 'var(--muted)', fontSize: 14.5 }}>
          Open your order on the <Link to="/track">tracking page</Link> and use "Contact support" to raise a ticket. An admin replies in the app.
          To report a scribe, a customer or prohibited material, use the form on the <Link to="/legal/integrity">academic integrity</Link> page.
        </p>
        <p style={{ fontSize: 14 }}>
          <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/refunds">Refunds</Link>
        </p>
      </div>
    </div>
  )
}
