import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { quote, inr, formatDuration, RATES } from '../lib/pricing'

function Stepper({ label, hint, value, onChange }: {
  label: string; hint: string; value: number; onChange: (n: number) => void
}) {
  return (
    <div className="stepper">
      <div>
        <div className="stepper-label">{label}</div>
        <div className="stepper-hint">{hint}</div>
      </div>
      <div className="stepper-ctl">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
        <span>{value}</span>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  )
}

export default function Calculator() {
  const [words, setWords] = useState(1000)
  const [simple, setSimple] = useState(0)
  const [complex, setComplex] = useState(0)
  const [graphs, setGraphs] = useState(0)
  const [template, setTemplate] = useState(false)
  const [showSplit, setShowSplit] = useState(false)

  const q = useMemo(
    () => quote({ words, simpleDrawings: simple, complexDrawings: complex, graphs, customTemplate: template }),
    [words, simple, complex, graphs, template],
  )

  return (
    <div className="calc">
      <div className="card calc-form">
        <label className="field">
          <span className="stepper-label">Word count</span>
          <input
            type="number" min={0} inputMode="numeric" value={words || ''}
            placeholder="e.g. 1200"
            onChange={(e) => setWords(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          <span className="stepper-hint">
            {q.pages >= RATES.minOrderPages ? `= ${q.pages} billable pages (rounded up)` : q.pages > 0 ? `= ${q.pages} page${q.pages > 1 ? 's' : ''}. Orders start at ${RATES.minOrderPages} pages.` : 'Enter the words in your finalized text'}
          </span>
        </label>

        <Stepper label="Simple drawings" hint="Up to 4 labels, single-line outline" value={simple} onChange={setSimple} />
        <Stepper label="Complex drawings" hint="5+ labels, circuits, shaded cross-sections" value={complex} onChange={setComplex} />
        <Stepper label="Calibrated graphs" hint="Scaled axes, plotted points, histograms" value={graphs} onChange={setGraphs} />

        <label className="check">
          <input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} />
          <span>
            <strong>College-crested paper</strong>
            <span className="stepper-hint"> — scribe prints your supplied template</span>
          </span>
        </label>
      </div>

      <aside className="card calc-quote" aria-live="polite">
        <h3>Your quote</h3>
        {q.pages === 0 ? (
          <p className="muted">Add a word count to see pricing.</p>
        ) : (
          <>
            <ul className="lines">
              {q.items.map((i) => (
                <li key={i.label}>
                  <div>
                    <div>{i.label}</div>
                    <div className="stepper-hint">{i.detail}</div>
                  </div>
                  <div>{inr(i.customer)}</div>
                </li>
              ))}
            </ul>
            <div className="total">
              <span>Total</span>
              <strong>{inr(q.customerTotal)}</strong>
            </div>
            <p className="eta">Estimated turnaround: <strong>{formatDuration(q.turnaroundHours)}</strong></p>

            <button type="button" className="link" onClick={() => setShowSplit((s) => !s)}>
              {showSplit ? 'Hide' : 'Show'} where the money goes
            </button>
            {showSplit && (
              <div className="split">
                <div><span>Scribe earns</span><strong>{inr(q.scribeTotal)}</strong></div>
                <div><span>Platform fee</span><strong>{inr(q.platformTotal)}</strong></div>
              </div>
            )}
            <Link className="btn btn-primary full" to="/order/upload">Start order</Link>
            {template && (
              <p className="stepper-hint">Template printing assumes ₹{RATES.templatePrintCostPerSheet}/sheet print cost.</p>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
