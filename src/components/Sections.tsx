const steps = [
  { n: '1', t: 'Upload your finished text', d: 'We count words and work out billable pages. Title and credential pages are flagged and removed.' },
  { n: '2', t: 'Choose a scribe', d: 'Browse verified handwriting sample cards. Pick the hand you like, then pay into escrow via UPI.' },
  { n: '3', t: 'Written and couriered', d: 'Your scribe writes to spec, then a local rider brings it to you. Share the OTP on delivery.' },
  { n: '4', t: 'Unbox and sign off', d: 'Record a continuous unboxing video, check the sheets, and add your own name and details.' },
]

export function HowItWorks() {
  return (
    <section id="how">
      <div className="container">
        <p className="eyebrow">How it works</p>
        <h2 className="section-title">Four steps from file to folder</h2>
        <div className="grid4">
          {steps.map((s) => (
            <div className="card step" key={s.n}>
              <div className="step-n">{s.n}</div>
              <h3>{s.t}</h3>
              <p className="muted">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const rules = [
  ['You supply the content', 'Scribes only copy what you give them. They never write, solve, research, or draft anything.'],
  ['No cover pages', 'Title pages, names, roll numbers, seals and index sheets are never written by a scribe. You add them yourself.'],
  ['Anonymous by design', 'No calls or chat between you and the scribe. Couriers use masked numbers and system IDs.'],
  ['Standard formatting', '1 inch left margin, 0.5 inch elsewhere, unpunched sheets, one pen and ink throughout.'],
  ['Max 3 corrections per page', 'A fourth whitener or any smudge means the scribe rewrites the sheet at their own cost.'],
  ['Style is your choice up front', 'Pick by sample card. Taste in slant or size is not refundable; a real mismatch with the card is disputable.'],
]

export function Rules() {
  return (
    <section id="rules">
      <div className="container">
        <p className="eyebrow">Ground rules</p>
        <h2 className="section-title">Built to stay a transcription utility</h2>
        <p className="section-sub">These rules protect scribes, customers and the platform.</p>
        <div className="grid3">
          {rules.map(([t, d]) => (
            <div className="card rule" key={t}>
              <h3>{t}</h3>
              <p className="muted">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span className="logo">Scribe<span>Link</span></span>
        <span className="muted">Prototype · Phase 1 · Not yet accepting orders</span>
      </div>
    </footer>
  )
}
