/**
 * App.tsx
 * Root application component. Sets up React Router, OrderContext (Phase 2),
 * and ScribePortalContext (Phase 3).
 */

import { useEffect, useReducer, type ReactNode } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'

import { OrderContext, orderReducer, INITIAL_ORDER, type OrderState } from './lib/orderStore'
import { RequireAuth } from './components/SignIn'
import { PortalProvider } from './lib/portal'
import type { Role } from './lib/api'

// Landing page components (Phase 1)
import Calculator from './components/Calculator'
import { HowItWorks, Rules, Footer } from './components/Sections'
import Icon from './components/Icons'
import Reveal from './components/Reveal'

// Order wizard (Phase 2)
import WizardLayout from './components/WizardLayout'
import StepUpload from './pages/StepUpload'
import StepAddons from './pages/StepAddons'
import StepScribe from './pages/StepScribe'
import StepCheckout from './pages/StepCheckout'
import OrderConfirmation from './pages/OrderConfirmation'

// Order tracking & Scribe app (Phase 3)
import ScribeLayout from './components/ScribeLayout'
import OrderTracker from './pages/OrderTracker'
import ScribeDashboard from './pages/ScribeDashboard'
import ScribeOnboarding from './pages/ScribeOnboarding'
import ScribeEarnings from './pages/ScribeEarnings'

import AdminPanel from './pages/AdminPanel'
import DisputeFiling from './pages/DisputeFiling'

import './App.css'
import './order.css'
import './phase3.css'
import './phase6.css'

// ── Landing page ──────────────────────────────────────────────────────────

function LandingPage() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="logo">Scribe<span>Link</span></Link>
          <nav aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#price">Pricing</a>
            <a href="#rules">Rules</a>
            <Link to="/track">Track order</Link>
            <Link to="/scribe/dashboard">Scribe portal</Link>
            <Link to="/order/upload" className="nav-cta">Place an order</Link>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="container">
            <span className="hero-pill"><i aria-hidden="true" />Peer-to-peer handwriting marketplace</span>
            <h1>Your notes, <span className="grad">written by hand.</span></h1>
            <p className="hero-sub">
              Upload your finished text. Choose a verified scribe by their handwriting. Neat pages arrive at your gate.
            </p>
            <div className="hero-cta">
              <Link className="btn btn-primary" to="/order/upload">Place an order</Link>
              <a className="text-link" href="#price">See pricing <Icon name="arrow" size={18} /></a>
            </div>

            <div className="stage">
              <div className="paper" aria-hidden="true">
                <div className="paper-margin" />
                <p className="scribble">Newton's second law states that the net force on a body equals the rate of change of its momentum…</p>
                <p className="scribble">F = ma</p>
                <p className="paper-tag">Sample card · Scribe #S-2041</p>
              </div>
              <span className="chip c1"><Icon name="tag" size={18} />₹30 per page</span>
              <span className="chip c2"><Icon name="shield" size={18} />Escrow protected</span>
              <span className="chip c3"><Icon name="eyeOff" size={18} />Fully anonymous</span>
            </div>
          </div>
        </section>

        <section className="facts-strip" aria-label="At a glance">
          <div className="container facts-grid">
            <Reveal className="fact"><b>₹30</b><span>per page, fixed</span></Reveal>
            <Reveal className="fact" delay={80}><b>24h</b><span>escrow window</span></Reveal>
            <Reveal className="fact" delay={160}><b>0</b><span>direct contact</span></Reveal>
          </div>
        </section>

        <HowItWorks />

        <section id="price">
          <div className="container">
            <Reveal className="head">
              <p className="eyebrow">Pricing</p>
              <h2 className="section-title">See your price before you commit.</h2>
              <p className="section-sub">One standard page is about 200 words. Add diagrams and graphs, and the total updates live.</p>
            </Reveal>
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

/** A signed-in area: asks for sign-in, then loads that role's data and shows the shared layout. */
function Area({ roles }: { roles: Role[] }) {
  return (
    <RequireAuth roles={roles}>
      {(role) => (
        <PortalProvider role={role} key={role}>
          <ScribeLayout role={role} />
        </PortalProvider>
      )}
    </RequireAuth>
  )
}

function Protected({ roles, children }: { roles: Role[]; children: ReactNode }) {
  return <RequireAuth roles={roles}>{() => children}</RequireAuth>
}

export default function App() {
  const [orderState, orderDispatch] = useReducer(orderReducer, INITIAL_ORDER, (init): OrderState => {
    try {
      const raw = sessionStorage.getItem('scribelink.v1.wizard')
      return raw ? { ...init, ...(JSON.parse(raw) as Partial<OrderState>) } : init
    } catch {
      return init
    }
  })
  // The in-progress order survives a refresh (per tab), so a reload mid-checkout does not lose the upload.
  useEffect(() => {
    try { sessionStorage.setItem('scribelink.v1.wizard', JSON.stringify(orderState)) } catch { /* ignore */ }
  }, [orderState])

  return (
    <OrderContext.Provider value={{ state: orderState, dispatch: orderDispatch }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route path="/order" element={<WizardLayout />}>
          <Route index element={<Navigate to="upload" replace />} />
          <Route path="upload"       element={<StepUpload />} />
          <Route path="addons"       element={<StepAddons />} />
          <Route path="scribe"       element={<StepScribe />} />
          <Route path="checkout"     element={<Protected roles={['customer']}><StepCheckout /></Protected>} />
          <Route path="confirmation" element={<OrderConfirmation />} />
        </Route>

        <Route path="/track" element={<Area roles={['customer']} />}>
          <Route index element={<OrderTracker />} />
          <Route path=":orderId" element={<OrderTracker />} />
        </Route>

        <Route path="/scribe" element={<Area roles={['scribe']} />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<ScribeDashboard />} />
          <Route path="onboarding" element={<ScribeOnboarding />} />
          <Route path="earnings" element={<ScribeEarnings />} />
        </Route>

        <Route path="/admin" element={<Area roles={['admin']} />}>
          <Route index element={<AdminPanel />} />
        </Route>
        <Route path="/dispute" element={<Area roles={['customer']} />}>
          <Route index element={<DisputeFiling />} />
          <Route path=":orderId" element={<DisputeFiling />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </OrderContext.Provider>
  )
}
