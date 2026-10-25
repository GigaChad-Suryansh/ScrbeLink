/**
 * ScribeLayout.tsx
 * Shared shell for the signed-in areas (scribe portal, customer tracker, admin).
 * The navigation follows the role that is signed in.
 */

import { Link, Outlet, useLocation } from 'react-router-dom'
import { useScribePortal } from '../lib/scribeStore'
import { signOut, useSessions, type Role } from '../lib/api'
import { inr } from '../lib/pricing'

const LABEL: Record<Role, string> = { customer: 'My orders', scribe: 'Scribe Portal', admin: 'Admin' }

export default function ScribeLayout({ role }: { role: Role }) {
  const { pathname } = useLocation()
  const { profile } = useScribePortal()
  const sessions = useSessions()
  const active = (p: string) => (pathname === p ? 'nav-link--active' : '')

  return (
    <>
      <header className="nav scribe-nav">
        <div className="container nav-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link to="/" className="logo">Scribe<span>Link</span></Link>
            <span className="scribe-portal-pill">{LABEL[role]}</span>
          </div>

          <nav>
            {role === 'scribe' && (
              <>
                <Link to="/scribe/dashboard" className={active('/scribe/dashboard')}>Dashboard</Link>
                <Link to="/scribe/earnings" className={active('/scribe/earnings')}>
                  Earnings ({inr(profile.walletBalance)})
                </Link>
                <Link to="/scribe/onboarding" className={active('/scribe/onboarding')}>Sample Card &amp; Profile</Link>
              </>
            )}
            {role === 'customer' && (
              <>
                <Link to="/track" className={pathname.startsWith('/track') ? 'nav-link--active' : ''}>Track orders</Link>
                <Link to="/order/upload">New order</Link>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost sm"
              onClick={() => signOut(role)}
              title={sessions[role]?.phone}
            >
              Sign out
            </button>
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
