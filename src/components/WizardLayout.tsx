/**
 * WizardLayout.tsx
 * Shared shell for all /order/* pages.
 * Shows a progress breadcrumb and wraps page content in a centred container.
 */

import { Outlet, useLocation, Link } from 'react-router-dom'

const STEPS = [
  { path: '/order/upload',       label: 'Upload' },
  { path: '/order/addons',       label: 'Add-ons' },
  { path: '/order/scribe',       label: 'Scribe' },
  { path: '/order/checkout',     label: 'Pay' },
  { path: '/order/confirmation', label: 'Done' },
]

export default function WizardLayout() {
  const { pathname } = useLocation()
  const currentIdx = STEPS.findIndex(s => s.path === pathname)

  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="logo">Scribe<span>Link</span></Link>
          <nav aria-label="Wizard progress">
            {STEPS.slice(0, 4).map((s, i) => (
              <span
                key={s.path}
                className={`wizard-crumb${i === currentIdx ? ' wizard-crumb--active' : ''}${i < currentIdx ? ' wizard-crumb--done' : ''}`}
                aria-current={i === currentIdx ? 'step' : undefined}
              >
                {i + 1}. {s.label}
              </span>
            ))}
          </nav>
        </div>
      </header>

      <main>
        <section>
          <div className="container">
            <Outlet />
          </div>
        </section>
      </main>
    </>
  )
}
