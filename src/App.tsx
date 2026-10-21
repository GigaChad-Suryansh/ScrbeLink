import Calculator from './components/Calculator'
import { HowItWorks, Rules, Footer } from './components/Sections'
import './App.css'

export default function App() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <a href="#top" className="logo">Scribe<span>Link</span></a>
          <nav>
            <a href="#how">How it works</a>
            <a href="#price">Pricing</a>
            <a href="#rules">Rules</a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <p className="eyebrow">Peer-to-peer handwriting marketplace</p>
              <h1>Your finished notes, written by hand and delivered to your gate.</h1>
              <p className="hero-sub">
                Upload your final text and diagrams. Pick a verified peer scribe by their handwriting
                sample. Get neat, uniform pages couriered to you. Fixed price per page.
              </p>
              <div className="hero-cta">
                <a className="btn btn-primary" href="#price">Get an instant quote</a>
                <a className="btn btn-ghost" href="#how">See how it works</a>
              </div>
              <ul className="hero-points">
                <li>₹30 per page</li>
                <li>Escrow-protected payment</li>
                <li>No chat, no contact: fully anonymous</li>
              </ul>
            </div>
            <div className="paper" aria-hidden="true">
              <div className="paper-margin" />
              <p className="scribble">Newton’s second law states that the net force on a body equals the rate of change of its momentum…</p>
              <p className="scribble">F = ma</p>
              <p className="paper-tag">Sample card · Scribe #S-2041</p>
            </div>
          </div>
        </section>

        <HowItWorks />

        <section id="price" className="alt">
          <div className="container">
            <p className="eyebrow">Pricing</p>
            <h2 className="section-title">See your price before you commit</h2>
            <p className="section-sub">
              One standard page is about 200 words. Add diagrams and graphs, and the total updates live.
            </p>
            <Calculator />
          </div>
        </section>

        <Rules />
      </main>
      <Footer />
    </>
  )
}
