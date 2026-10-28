/**
 * pages/DisputeFiling.tsx
 * Customer unboxing-video dispute filing portal:
 * - Select order reason
 * - Upload/attach unboxing video evidence
 * - Freeze escrow release until review
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icons'
import { api } from '../lib/api'
import { useScribePortal } from '../lib/scribeStore'
import { checkFile, uploadHint } from '../lib/checkUpload'
import type { DisputeRecord } from '../shared/logisticsDisputes'

export default function DisputeFiling() {
  const { orderId } = useParams<{ orderId: string }>()
  const nav = useNavigate()

  const { orders } = useScribePortal()
  const [targetOrderId, setTargetOrderId] = useState(orderId || '')
  const [reason, setReason] = useState<DisputeRecord['reason']>('MISSING_PAGES')
  const [notes, setNotes] = useState('')
  // No default: a claim needs a real, validated video (rule 4).
  const [videoFile, setVideoFile] = useState<string>('')
  /** Server URL of the uploaded video. */
  const [videoUrl, setVideoUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  // Redirect after a moment, but never once the person has already moved elsewhere.
  useEffect(() => {
    if (!submitted) return
    const t = setTimeout(() => nav(`/track/${targetOrderId.trim()}`), 2000)
    return () => clearTimeout(t)
  }, [submitted, nav, targetOrderId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!videoUrl) {
      setVideoError('Attach your continuous unboxing video to file a claim.')
      return
    }
    setBusy(true)
    setSubmitError('')
    try {
      await api('POST', '/api/disputes/file', {
        as: 'customer',
        body: { orderId: targetOrderId.trim(), reason, unboxingVideoUrl: videoUrl, customerNotes: notes },
      })
      setSubmitted(true)
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onVideoPicked(input: HTMLInputElement) {
    const f = input.files?.[0]
    if (!f) return
    setVideoError('')
    const verdict = await checkFile(f, 'video')
    if (!verdict.ok) {
      setVideoError(verdict.error)
      setVideoFile('')
      setVideoUrl('')
      input.value = ''
      return
    }
    setUploading(true)
    try {
      const r = await api<{ url: string }>('POST', '/api/uploads/video', { as: 'customer', raw: f, headers: { 'x-file-name': encodeURIComponent(f.name) } })
      setVideoUrl(r.url)
      setVideoFile(f.name)
    } catch (err) {
      setVideoError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="dispute-filing-page" style={{ maxWidth: 700, margin: '0 auto', padding: '24px 0' }}>
      <span className="eyebrow">Customer Protection Guarantee</span>
      <h1 className="section-title">Open an Unboxing Video Dispute</h1>
      <p className="section-sub">
        If pages are missing, handwriting is illegible, or the seal arrived compromised, submit an unboxing video to freeze escrow payout immediately.
      </p>

      {submitted ? (
        <div className="alert alert--ok" style={{ marginTop: 24 }}>
          Dispute filed. Escrow funds for #{targetOrderId} have been locked. Redirecting to Order Tracker...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card" style={{ padding: 24, marginTop: 24 }}>
          <div className="field">
            <label htmlFor="order-id-input">Order Reference ID</label>
            <datalist id="delivered-orders">
              {orders.filter(o => o.status === 'Delivered').map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </datalist>
            <input
              id="order-id-input"
              type="text"
              required
              value={targetOrderId}
              onChange={e => setTargetOrderId(e.target.value)}
              placeholder="e.g. SL-1A2B3C" list="delivered-orders"
            />
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="dispute-reason">Primary Dispute Category</label>
            <select
              id="dispute-reason"
              className="select-input"
              value={reason}
              onChange={e => setReason(e.target.value as any)}
            >
              <option value="MISSING_PAGES">Missing / Skipped Pages</option>
              <option value="ILLEGIBLE_HANDWRITING">Illegible Handwriting / Major Ink Bleed</option>
              <option value="INCORRECT_DIAGRAMS">Inaccurate / Missed Calibrated Diagrams</option>
              <option value="DAMAGED_ENVELOPE">Damaged Envelope or Broken Seal</option>
              <option value="OTHER">Other Discrepancy</option>
            </select>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label>Unboxing Video Requirement</label>
            <div
              className="sample-upload-zone"
              onClick={() => document.getElementById('unboxing-file-input')?.click()}
            >
              <input
                id="unboxing-file-input"
                type="file"
                accept=".mp4,.mov"
                style={{ display: 'none' }}
                onChange={e => onVideoPicked(e.target)}
              />
              <span style={{ color: 'var(--muted)' }}><Icon name="video" size={32} /></span>
              <p style={{ fontWeight: 600, margin: '6px 0 2px' }}>
                {uploading ? 'Uploading video…' : videoFile ? `Attached: ${videoFile}` : 'Upload video showing intact seal opening'}
              </p>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Rule 4: continuous single-take video required for escrow refund. {uploadHint('video')}.
              </span>
            </div>
            {videoError && <p role="alert" style={{ color: 'var(--warn)', fontSize: 13, marginTop: 6 }}>{videoError}</p>}
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="dispute-notes">Description of Defect</label>
            <textarea
              id="dispute-notes"
              rows={4}
              required
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe which pages or diagrams were omitted or improperly completed..."
              className="text-area-input"
            />
          </div>

          {submitError && <div className="alert alert--warn" role="alert" style={{ marginTop: 16 }}>{submitError}</div>}
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button type="submit" className="btn btn-primary full" id="submit-dispute-btn" disabled={!videoUrl || uploading || busy}>
              {busy ? 'Filing…' : 'Lock Escrow & File Claim'}
            </button>
            <Link to={`/track/${targetOrderId}`} className="btn btn-ghost full" style={{ textAlign: 'center' }}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  )
}
