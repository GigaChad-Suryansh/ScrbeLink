/**
 * ScribeLayout.tsx
 * Shared layout navigation bar for Scribe Portal:
 * - Direct access to Dashboard, Onboarding profile, Earnings
 * - Scribe active state indicators
 */

import { Link, Outlet, useLocation } from 'react-router-dom'
import { useScribePortal } from '../lib/scribeStore'
import { inr } from '../lib/pricing'

export default function ScribeLayout() {
  const { pathname } = useLocation()
  const { profile } = useScribePortal()

  return (
    <>
      <header className="nav scribe-nav">
        <div className="container nav-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link to="/" className="logo">Scribe<span>Link</span></Link>
            <span className="scribe-portal-pill">Scribe Portal</span>
          </div>

          <nav>
            <Link
              to="/scribe/dashboard"
              className={pathname === '/scribe/dashboard' ? 'nav-link--active' : ''}
            >
              Dashboard
            </Link>
            <Link
              to="/scribe/earnings"
              className={pathname === '/scribe/earnings' ? 'nav-link--active' : ''}
            >
              Earnings ({inr(profile.walletBalance)})
            </Link>
            <Link
              to="/scribe/onboarding"
              className={pathname === '/scribe/onboarding' ? 'nav-link--active' : ''}
            >
              Sample Card &amp; Profile
            </Link>
            <Link to="/track" className="nav-link--track">
              Customer Tracker ➔
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section style={{ paddingTop: 40, paddingBottom: 64 }}>
          <div className="container">
            <Outlet />
          </div>
        </section>
      </main>
    </>
  )
}
