/**
 * App.tsx
 * Root application component.  Sets up React Router and the shared order state.
 */

import { useReducer } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

import { OrderContext, orderReducer, INITIAL_ORDER } from './lib/orderStore'

// Landing page components (Phase 1)
import Calculator from './components/Calculator'
import { HowItWorks, Rules, Footer } from './components/Sections'

// Order wizard (Phase 2)
import WizardLayout from './components/WizardLayout'
import StepUpload from './pages/StepUpload'
import StepAddons from './pages/StepAddons'
import StepScribe from './pages/StepScribe'
import StepCheckout from './pages/StepCheckout'
import OrderConfirmation from './pages/OrderConfirmation'

import './App.css'
import './order.css'

// ── Landing page ──────────────────────────────────────────────────────────

function LandingPage() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <a href="/" className="logo">Scribe<span>Link</span></a>
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
                <a className="btn btn-primary" href="/order/upload">Place an order</a>
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
              <p className="scribble">Newton's second law states that the net force on a body equals the rate of change of its momentum…</p>
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

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(orderReducer, INITIAL_ORDER)

  return (
    <OrderContext.Provider value={{ state, dispatch }}>
      <Routes>
        {/* Landing */}
        <Route path="/" element={<LandingPage />} />

        {/* Order wizard */}
        <Route path="/order" element={<WizardLayout />}>
          <Route index element={<Navigate to="upload" replace />} />
          <Route path="upload"       element={<StepUpload />} />
          <Route path="addons"       element={<StepAddons />} />
          <Route path="scribe"       element={<StepScribe />} />
          <Route path="checkout"     element={<StepCheckout />} />
          <Route path="confirmation" element={<OrderConfirmation />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </OrderContext.Provider>
  )
}
