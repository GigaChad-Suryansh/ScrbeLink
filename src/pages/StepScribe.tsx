/**
 * StepScribe.tsx  –  Step 3 of the order wizard
 * Lists the approved scribes from the API with their handwriting sample; the customer picks one,
 * or lets any approved scribe take the order.
 */

import Icon from '../components/Icons'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrder } from '../lib/orderStore'
import { api } from '../lib/api'

interface PublicScribe {
  id: string
  name: string
  college: string
  specialties: string[]
  sample: string
  sampleImageUrl?: string
  completedOrders: number
  available: boolean
}

export default function StepScribe() {
  const { state, dispatch } = useOrder()
  const nav = useNavigate()
  const [scribes, setScribes] = useState<PublicScribe[] | null>(null)
  const [error, setError] = useState('')
  /** 'any' lets the first approved scribe who sees the order accept it. */
  const [selected, setSelected] = useState<string>(state.scribeId ?? 'any')

  useEffect(() => {
    api<{ scribes: PublicScribe[] }>('GET', '/api/scribes')
      .then((r) => setScribes(r.scribes))
      .catch((e: Error) => setError(e.message))
  }, [])

  function onNext() {
    const pick = scribes?.find((s) => s.id === selected)
    dispatch({ type: 'SET_SCRIBE', scribeId: pick ? pick.id : null, scribeName: pick ? pick.name : null })
    nav('/order/checkout')
  }

  return (
    <div className="wizard-step">
      <p className="eyebrow">Step 3 of 4</p>
      <h2 className="section-title">Pick your scribe</h2>
      <p className="section-sub" style={{ marginBottom: 28 }}>
        Each card shows a real handwriting sample. All scribes are verified by ScribeLink.
        Your order is fully anonymous: the scribe never sees your name.
      </p>

      {error && <div className="alert alert--warn" role="alert">{error}</div>}
      {!scribes && !error && <p className="section-sub">Loading scribes…</p>}

      {scribes && (
        <div className="scribe-grid">
          <button
            id="scribe-any"
            className={`scribe-card card${selected === 'any' ? ' scribe-card--active' : ''}`}
            onClick={() => setSelected('any')}
            aria-pressed={selected === 'any'}
            aria-label="Any approved scribe"
          >
            {selected === 'any' && <span className="scribe-badge scribe-badge--selected">Selected</span>}
            <div className="scribe-header">
              <div className="scribe-avatar" aria-hidden="true"><Icon name="check" size={20} /></div>
              <div>
                <p className="scribe-name">Any approved scribe</p>
                <p className="scribe-tag">Fastest match</p>
              </div>
            </div>
            <p className="scribe-meta-txt" style={{ marginTop: 12 }}>
              The first verified scribe who is free accepts your order. {scribes.length === 0 && 'No scribe has been approved yet, so your order will wait in the queue.'}
            </p>
          </button>

          {scribes.map((s) => (
            <button
              key={s.id}
              id={`scribe-${s.id}`}
              className={`scribe-card card${selected === s.id ? ' scribe-card--active' : ''}${!s.available ? ' scribe-card--busy' : ''}`}
              onClick={() => s.available && setSelected(s.id)}
              disabled={!s.available}
              aria-pressed={selected === s.id}
              aria-label={`Select scribe ${s.name}`}
            >
              {!s.available && <span className="scribe-badge scribe-badge--busy">Busy</span>}
              {selected === s.id && <span className="scribe-badge scribe-badge--selected">Selected</span>}

              <div className="scribe-header">
                <div className="scribe-avatar" aria-hidden="true">{s.name[0]}</div>
                <div>
                  <p className="scribe-name">{s.name}</p>
                  <p className="scribe-tag">#{s.id} · {s.specialties[0] ?? s.college}</p>
                </div>
              </div>

              <div className="scribe-meta">
                <span className="scribe-meta-txt">{s.completedOrders} orders completed</span>
              </div>

              <div className="paper scribe-sample" aria-label="Handwriting sample">
                <div className="paper-margin" />
                {s.sampleImageUrl && <img src={s.sampleImageUrl} alt={`Handwriting sample by ${s.name}`} style={{ maxHeight: 110, borderRadius: 8, marginBottom: 6 }} />}
                <p className="scribble">{s.sample}</p>
                <p className="paper-tag">Sample · {s.id}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="wizard-nav">
        <button className="btn btn-ghost" onClick={() => nav('/order/addons')} id="scribe-back-btn">Back</button>
        <button className="btn btn-primary" onClick={onNext} disabled={!scribes} id="scribe-next-btn">
          Next: Review &amp; pay →
        </button>
      </div>
    </div>
  )
}
