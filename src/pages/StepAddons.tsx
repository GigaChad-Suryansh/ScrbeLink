/**
 * StepAddons.tsx  –  Step 2 of the order wizard
 * Lets the customer configure diagrams/graphs add-ons, pen type, ink colour,
 * and custom template option.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrder } from '../lib/orderStore'
import type { PenType, InkColor } from '../lib/orderStore'

interface StepperProps {
  label: string
  hint: string
  value: number
  onChange: (v: number) => void
  id: string
}

function Stepper({ label, hint, value, onChange, id }: StepperProps) {
  return (
    <div className="stepper">
      <div>
        <p className="stepper-label">{label}</p>
        <p className="stepper-hint">{hint}</p>
      </div>
      <div className="stepper-ctl">
        <button onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Decrease ${label}`}>−</button>
        <span id={id} aria-live="polite">{value}</span>
        <button onClick={() => onChange(value + 1)} aria-label={`Increase ${label}`}>+</button>
      </div>
    </div>
  )
}

export default function StepAddons() {
  const { state, dispatch } = useOrder()
  const nav = useNavigate()

  const [simple, setSimple] = useState(state.simpleDrawings)
  const [complex, setComplex] = useState(state.complexDrawings)
  const [graphs, setGraphs] = useState(state.graphs)
  const [template, setTemplate] = useState(state.customTemplate)
  const [pen, setPen] = useState<PenType>(state.pen)
  const [ink, setInk] = useState<InkColor>(state.ink)

  function onNext() {
    dispatch({ type: 'SET_ADDONS', simpleDrawings: simple, complexDrawings: complex, graphs, customTemplate: template })
    dispatch({ type: 'SET_PEN', pen, ink })
    nav('/order/scribe')
  }

  function onBack() {
    nav('/order/upload')
  }

  const penOptions: { value: PenType; label: string; desc: string }[] = [
    { value: 'ballpoint', label: 'Ballpoint', desc: 'Smooth, consistent line · most common' },
    { value: 'gel', label: 'Gel', desc: 'Bold, vivid strokes · slightly slower' },
    { value: 'fountain', label: 'Fountain', desc: 'Classic, variable weight · premium look' },
  ]

  const inkOptions: { value: InkColor; label: string }[] = [
    { value: 'blue', label: 'Blue' },
    { value: 'black', label: 'Black' },
  ]

  return (
    <div className="wizard-step">
      <p className="eyebrow">Step 2 of 4</p>
      <h2 className="section-title">Add-ons &amp; pen preferences</h2>

      <div className="addon-grid">
        {/* ── Add-ons column ── */}
        <div>
          <h3 className="addon-section-title">Diagrams &amp; graphs</h3>
          <div className="card" style={{ padding: '0 20px' }}>
            <Stepper
              id="cnt-simple"
              label="Simple drawings"
              hint="+₹4 each · basic shapes, flow charts"
              value={simple}
              onChange={setSimple}
            />
            <Stepper
              id="cnt-complex"
              label="Complex drawings"
              hint="+₹8 each · cross-sections, detailed diagrams"
              value={complex}
              onChange={setComplex}
            />
            <Stepper
              id="cnt-graphs"
              label="Calibrated graphs"
              hint="+₹10 each · graph paper, axis labels"
              value={graphs}
              onChange={setGraphs}
            />
          </div>

          <label className="check card" style={{ marginTop: 12, padding: '16px 20px' }}>
            <input
              type="checkbox"
              checked={template}
              onChange={e => setTemplate(e.target.checked)}
              id="check-template"
            />
            <div>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Custom college template</p>
              <p style={{ fontSize: 14, color: 'var(--muted)' }}>
                Scribe prints on your institution's ruled/graph sheet design.
                +₹4 per page (₹2 printing + ₹2 markup).
              </p>
            </div>
          </label>
        </div>

        {/* ── Pen & ink column ── */}
        <div>
          <h3 className="addon-section-title">Pen type</h3>
          <div className="pen-grid">
            {penOptions.map(opt => (
              <label
                key={opt.value}
                className={`pen-card card${pen === opt.value ? ' pen-card--active' : ''}`}
                htmlFor={`pen-${opt.value}`}
              >
                <input
                  type="radio"
                  name="pen"
                  id={`pen-${opt.value}`}
                  value={opt.value}
                  checked={pen === opt.value}
                  onChange={() => setPen(opt.value)}
                  style={{ display: 'none' }}
                />
                <p style={{ fontWeight: 600, marginBottom: 4 }}>{opt.label}</p>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>{opt.desc}</p>
              </label>
            ))}
          </div>

          <h3 className="addon-section-title" style={{ marginTop: 20 }}>Ink colour</h3>
          <div className="ink-row">
            {inkOptions.map(opt => (
              <label
                key={opt.value}
                className={`ink-chip${ink === opt.value ? ' ink-chip--active' : ''}`}
                htmlFor={`ink-${opt.value}`}
              >
                <input
                  type="radio"
                  name="ink"
                  id={`ink-${opt.value}`}
                  value={opt.value}
                  checked={ink === opt.value}
                  onChange={() => setInk(opt.value)}
                  style={{ display: 'none' }}
                />
                <span className={`ink-dot ink-dot--${opt.value}`} />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="wizard-nav">
        <button className="btn btn-ghost" onClick={onBack} id="addons-back-btn">Back</button>
        <button className="btn btn-primary" onClick={onNext} id="addons-next-btn">
          Next: Pick a scribe →
        </button>
      </div>
    </div>
  )
}
