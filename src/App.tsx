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

import './App.css'
import './order.css'
import './phase3.css'

// ── Landing page ──────────────────────────────────────────────────────────

function LandingPage() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="logo">Scribe<span>Link</span></Link>
          <nav>
            <a href="#how">How it works</a>
            <a href="#price">Pricing</a>
            <a href="#rules">Rules</a>
            <Link to="/track">Track Order</Link>
            <Link to="/scribe/dashboard" style={{ color: 'var(--brand)', fontWeight: 600 }}>
              Scribe Portal ➔
            </Link>
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
                <Link className="btn btn-primary" to="/order/upload">Place an order</Link>
                <Link className="btn btn-ghost" to="/track">Track active order</Link>
                <Link className="btn btn-ghost" to="/scribe/dashboard">Become / Open Scribe Partner</Link>
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

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ScribePortalContext.Provider>
    </OrderContext.Provider>
  )
}
