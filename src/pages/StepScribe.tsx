/**
 * StepScribe.tsx  –  Step 3 of the order wizard
 * Shows mock scribe cards with handwriting samples; user picks one.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrder, MOCK_SCRIBES } from '../lib/orderStore'

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} stars`} className="scribe-stars">
      {'★'.repeat(Math.floor(n))}{'☆'.repeat(5 - Math.floor(n))}
    </span>
  )
}

export default function StepScribe() {
  const { state, dispatch } = useOrder()
  const nav = useNavigate()
  const [selected, setSelected] = useState<string | null>(state.scribeId)

  function onNext() {
    if (!selected) return
    dispatch({ type: 'SET_SCRIBE', scribeId: selected })
    nav('/order/checkout')
  }

  function onBack() {
    nav('/order/addons')
  }

  return (
    <div className="wizard-step">
      <p className="eyebrow">Step 3 of 4</p>
      <h2 className="section-title">Pick your scribe</h2>
      <p className="section-sub" style={{ marginBottom: 28 }}>
        Each card shows a real handwriting sample. All scribes are verified by ScribeLink.
        Your order is fully anonymous — the scribe never sees your name.
      </p>

      <div className="scribe-grid">
        {MOCK_SCRIBES.map(s => (
          <button
            key={s.id}
            id={`scribe-${s.id}`}
            className={`scribe-card card${selected === s.id ? ' scribe-card--active' : ''}${!s.available ? ' scribe-card--busy' : ''}`}
            onClick={() => s.available && setSelected(s.id)}
            disabled={!s.available}
            aria-pressed={selected === s.id}
            aria-label={`Select scribe ${s.name}`}
          >
            {/* Badge */}
            {!s.available && <span className="scribe-badge scribe-badge--busy">Busy</span>}
            {selected === s.id && <span className="scribe-badge scribe-badge--selected">✓ Selected</span>}

            <div className="scribe-header">
              <div className="scribe-avatar" aria-hidden="true">
                {s.name[0]}
              </div>
              <div>
                <p className="scribe-name">{s.name}</p>
                <p className="scribe-tag">#{s.tag} · {s.specialty}</p>
              </div>
            </div>

            <div className="scribe-meta">
              <Stars n={s.rating} />
              <span className="scribe-meta-txt">{s.rating} · {s.ordersCompleted} orders</span>
            </div>

            {/* Handwriting sample */}
            <div className="paper scribe-sample" aria-label="Handwriting sample">
              <div className="paper-margin" />
              <p className="scribble">{s.sample}</p>
              <p className="paper-tag">Sample · {s.tag}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="wizard-nav">
        <button className="btn btn-ghost" onClick={onBack} id="scribe-back-btn">← Back</button>
        <button
          className="btn btn-primary"
          onClick={onNext}
          disabled={!selected}
          id="scribe-next-btn"
        >
          Next: Review &amp; pay →
        </button>
      </div>
    </div>
  )
}
