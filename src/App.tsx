/**
 * App.tsx
 * Root application component. Sets up React Router, OrderContext (Phase 2),
 * and ScribePortalContext (Phase 3).
 */

import { useReducer, useState } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'

import { OrderContext, orderReducer, INITIAL_ORDER } from './lib/orderStore'
import {
  ScribePortalContext,
  INITIAL_SCRIBE_PROFILE,
  INITIAL_ORDERS,
  INITIAL_PAYOUTS,
  type ScribeProfile,
  type TrackableOrder,
  type PayoutTransaction,
  type OrderStatus,
} from './lib/scribeStore'

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

export default function App() {
  const [orderState, orderDispatch] = useReducer(orderReducer, INITIAL_ORDER)

  // Phase 3 Scribe portal state
  const [profile, setProfile] = useState<ScribeProfile>(INITIAL_SCRIBE_PROFILE)
  const [orders, setOrders] = useState<TrackableOrder[]>(INITIAL_ORDERS)
  const [payouts, setPayouts] = useState<PayoutTransaction[]>(INITIAL_PAYOUTS)

  function updateProfile(updated: Partial<ScribeProfile>) {
    setProfile(prev => ({ ...prev, ...updated }))
  }

  function acceptOrder(orderId: string) {
    setOrders(prev =>
      prev.map(o => {
        if (o.id !== orderId) return o
        const nextStatus: OrderStatus = 'Accepted'
        return {
          ...o,
          status: nextStatus,
          scribeId: profile.id,
          scribeName: profile.name,
          intakeInspectionExpiresAt: '28 mins left',
          timeline: [
            ...o.timeline,
            {
              status: nextStatus,
              timestamp: 'Just now',
              note: `Accepted by ${profile.name}. 30-minute intake window active.`,
            },
          ],
        }
      })
    )
  }

  function advanceOrderStatus(orderId: string, nextStatus: OrderStatus, note: string) {
    setOrders(prev =>
      prev.map(o => {
        if (o.id !== orderId) return o
        let nextCheckIn = o.nextCheckInDueAt
        let otp = o.otp

        if (nextStatus === 'Writing') {
          nextCheckIn = '58 mins remaining'
        } else if (nextStatus === 'Dispatched') {
          otp = otp || String(Math.floor(1000 + Math.random() * 9000))
        }

        return {
          ...o,
          status: nextStatus,
          nextCheckInDueAt: nextCheckIn,
          otp,
          timeline: [
            ...o.timeline,
            {
              status: nextStatus,
              timestamp: 'Just now',
              note,
            },
          ],
        }
      })
    )

    // Scribe wallet updates if delivered
    if (nextStatus === 'Delivered') {
      const target = orders.find(o => o.id === orderId)
      if (target) {
        setProfile(p => ({
          ...p,
          walletBalance: p.walletBalance + target.scribePayout,
          pendingEscrow: Math.max(0, p.pendingEscrow - target.scribePayout),
          totalOrders: p.totalOrders + 1,
        }))
        setPayouts(p => [
          {
            id: `TX-${Math.floor(1000 + Math.random() * 9000)}`,
            orderId,
            amount: target.scribePayout,
            status: 'Released',
            date: 'Just now',
            upiVpa: profile.upiVpa,
          },
          ...p,
        ])
      }
    }
  }

  function submitCheckIn(orderId: string) {
    setOrders(prev =>
      prev.map(o => {
        if (o.id !== orderId) return o
        return {
          ...o,
          nextCheckInDueAt: '59 mins remaining',
        }
      })
    )
  }

  return (
    <OrderContext.Provider value={{ state: orderState, dispatch: orderDispatch }}>
      <ScribePortalContext.Provider
        value={{
          profile,
          orders,
          payouts,
          updateProfile,
          acceptOrder,
          advanceOrderStatus,
          submitCheckIn,
        }}
      >
        <Routes>
          {/* Landing */}
          <Route path="/" element={<LandingPage />} />

          {/* Phase 2: Order wizard */}
          <Route path="/order" element={<WizardLayout />}>
            <Route index element={<Navigate to="upload" replace />} />
            <Route path="upload"       element={<StepUpload />} />
            <Route path="addons"       element={<StepAddons />} />
            <Route path="scribe"       element={<StepScribe />} />
            <Route path="checkout"     element={<StepCheckout />} />
            <Route path="confirmation" element={<OrderConfirmation />} />
          </Route>

          {/* Phase 3: Customer Order Tracker */}
          <Route path="/track" element={<ScribeLayout />}>
            <Route index element={<OrderTracker />} />
            <Route path=":orderId" element={<OrderTracker />} />
          </Route>

          {/* Phase 3: Scribe App & Dashboard */}
          <Route path="/scribe" element={<ScribeLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<ScribeDashboard />} />
            <Route path="onboarding" element={<ScribeOnboarding />} />
            <Route path="earnings" element={<ScribeEarnings />} />
          </Route>

          {/* Phase 6: Admin Panel & Disputes */}
          <Route path="/admin" element={<ScribeLayout />}>
            <Route index element={<AdminPanel />} />
          </Route>
          <Route path="/dispute" element={<ScribeLayout />}>
            <Route index element={<DisputeFiling />} />
            <Route path=":orderId" element={<DisputeFiling />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ScribePortalContext.Provider>
    </OrderContext.Provider>
  )
}
