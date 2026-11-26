/**
 * RateScribe.tsx
 * One rating per order, shown once the pages are delivered.
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export default function RateScribe({ orderId }: { orderId: string }) {
  const [done, setDone] = useState<{ stars: number; comment: string } | null | undefined>(undefined)
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ rating: { stars: number; comment: string } | null }>('GET', `/api/orders/${orderId}/rating`, { as: 'customer' })
      .then((r) => setDone(r.rating)).catch(() => setDone(null))
  }, [orderId])

  const submit = async () => {
    setError('')
    try { await api('POST', `/api/orders/${orderId}/rating`, { as: 'customer', body: { stars, comment } }); setDone({ stars, comment }) }
    catch (e) { setError((e as Error).message) }
  }

  if (done === undefined) return null
  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }} id="rating-card">
      <strong>{done ? 'Thanks for rating your scribe' : 'How was the handwriting?'}</strong>
      <div role="radiogroup" aria-label="Stars" style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={(done?.stars ?? stars) === n} disabled={!!done}
            className={`btn ${(done?.stars ?? stars) >= n ? 'btn-primary' : 'btn-ghost'} sm`} onClick={() => setStars(n)}>{n}</button>
        ))}
      </div>
      {!done && (
        <>
          <textarea aria-label="Comment (optional)" placeholder="Comment (optional)" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} />
          {error && <p className="alert alert--warn" role="alert">{error}</p>}
          <button className="btn btn-primary" disabled={stars === 0} onClick={submit} style={{ marginTop: 8 }}>Submit rating</button>
        </>
      )}
    </div>
  )
}
