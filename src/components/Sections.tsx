import { Link } from 'react-router-dom'
import Icon, { type IconName } from './Icons'
import Reveal from './Reveal'
import { resetDemoData } from '../lib/usePersistentState'

export function HowItWorks() {
  return (
    <section id="how">
      <div className="container">
        <Reveal className="head">
          <p className="eyebrow">How it works</p>
          <h2 className="section-title">From file to folder, in four steps.</h2>
          <p className="section-sub">You bring the finished text. A verified peer writes it out by hand. A local rider brings it to you.</p>
        </Reveal>

        <div className="bento">
          <Reveal className="tile s4">
            <div className="tile-top"><span className="ico"><Icon name="upload" /></span><span className="num">01</span></div>
            <div>
              <h3>Upload your finished text</h3>
              <p>We count the words, work out your billable pages, and flag any title or credential pages so they never reach a scribe.</p>
            </div>
            <div className="mini-drop" aria-hidden="true"><span className="mini-file">assignment.pdf</span>12 pages · 2,380 words · cover page removed</div>
          </Reveal>

          <Reveal className="tile s2" delay={80}>
            <div className="tile-top"><span className="ico"><Icon name="pen" /></span><span className="num">02</span></div>
            <div>
              <h3>Choose a hand you like</h3>
              <p>Browse verified handwriting samples and pay into escrow.</p>
            </div>
          </Reveal>

          <Reveal className="tile s2" delay={40}>
            <div className="tile-top"><span className="ico"><Icon name="truck" /></span><span className="num">03</span></div>
            <div>
              <h3>Written and couriered</h3>
              <p>Your scribe writes to spec. A local rider delivers to your gate.</p>
            </div>
            <div className="mini-track" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /><i /></div>
          </Reveal>

          <Reveal className="tile s4 ink" delay={120}>
            <div className="tile-top"><span className="ico"><Icon name="check" /></span><span className="num">04</span></div>
            <div>
              <h3>Unbox, check, sign off</h3>
              <p>Share the delivery OTP, film a continuous unboxing video, and check the sheets. You add your own name and details. Payment releases 24 hours after delivery.</p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

const rules: { icon: IconName; t: string; d: string; wide?: boolean; ink?: boolean }[] = [
  { icon: 'file', t: 'You supply the content', d: 'Scribes only copy what you give them. They never write, solve, research, or draft anything.', wide: true },
  { icon: 'shield', t: 'No cover pages', d: 'Names, roll numbers, seals and index sheets are never written by a scribe. You add them yourself.', ink: true },
  { icon: 'eyeOff', t: 'Anonymous by design', d: 'No calls or chat between you and the scribe. Couriers use masked numbers and system IDs.' },
  { icon: 'ruler', t: 'Standard formatting', d: '1 inch left margin, 0.5 inch elsewhere, unpunched sheets, one pen and ink throughout.' },
  { icon: 'rotate', t: 'Three corrections per page', d: 'A fourth whitener or any smudge means the scribe rewrites the sheet at their own cost.' },
  { icon: 'tag', t: 'Style is chosen up front', d: 'Pick by sample card. Taste in slant or size is not refundable; a real mismatch with the card is disputable.', wide: true },
]

export function Rules() {
  return (
    <section id="rules">
      <div className="container">
        <Reveal className="head">
          <p className="eyebrow">Ground rules</p>
          <h2 className="section-title">A transcription service. Nothing more.</h2>
          <p className="section-sub">These rules protect scribes, customers and the platform.</p>
        </Reveal>

        <div className="bento">
          {rules.map((r, i) => (
            <Reveal key={r.t} className={`tile ${i === rules.length - 1 ? 's6' : r.wide ? 's4' : 's2'}${r.ink ? ' ink' : ''}`} delay={(i % 3) * 70}>
              <span className="ico"><Icon name={r.icon} /></span>
              <div>
                <h3>{r.t}</h3>
                <p>{r.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Link to="/" className="logo">Scribe<span>Link</span></Link>
            <p style={{ marginTop: 12, maxWidth: '30ch' }}>Handwritten transcription of your finished work, by verified peers.</p>
          </div>
          <div>
            <h4>Customers</h4>
            <ul>
              <li><Link to="/order/upload">Place an order</Link></li>
              <li><Link to="/track">Track an order</Link></li>
              <li><Link to="/dispute">Open a dispute</Link></li>
            </ul>
          </div>
          <div>
            <h4>Scribes</h4>
            <ul>
              <li><Link to="/scribe/dashboard">Scribe portal</Link></li>
              <li><Link to="/scribe/onboarding">Handwriting profile</Link></li>
              <li><Link to="/scribe/earnings">Earnings</Link></li>
            </ul>
          </div>
          <div>
            <h4>ScribeLink</h4>
            <ul>
              <li><a href="/#how">How it works</a></li>
              <li><a href="/#price">Pricing</a></li>
              <li><a href="/#rules">Ground rules</a></li>
              <li><Link to="/admin">Admin</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-note">
          <span>Prototype · demo data only · no real payments</span>
          <button type="button" className="link" style={{ margin: 0, minHeight: 0, padding: 0 }} onClick={() => { resetDemoData(); window.location.assign('/') }}>Reset demo data</button>
        </div>
      </div>
    </footer>
  )
}
