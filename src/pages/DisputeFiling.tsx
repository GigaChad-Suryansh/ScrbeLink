/**
 * pages/DisputeFiling.tsx
 * Customer unboxing-video dispute filing portal:
 * - Select order reason
 * - Upload/attach unboxing video evidence
 * - Freeze escrow release until review
 */

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { globalLogistics } from '../backend/logisticsService'
import type { DisputeRecord } from '../shared/logisticsDisputes'

export default function DisputeFiling() {
  const { orderId } = useParams<{ orderId: string }>()
  const nav = useNavigate()

  const [targetOrderId, setTargetOrderId] = useState(orderId || 'SL-5830')
  const [reason, setReason] = useState<DisputeRecord['reason']>('MISSING_PAGES')
  const [notes, setNotes] = useState('')
  const [videoFile, setVideoFile] = useState<string>('unboxing_proof.mp4')
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    globalLogistics.fileDispute(
      targetOrderId,
      reason,
      `https://storage.scribelink.in/unboxing/${videoFile}`,
      notes || 'Package was inspected on arrival at college gate.'
    )
    setSubmitted(true)
    setTimeout(() => {
      nav(`/track/${targetOrderId}`)
    }, 2000)
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
          ✓ Dispute successfully filed! Escrow funds for #{targetOrderId} have been locked. Redirecting to Order Tracker...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card" style={{ padding: 24, marginTop: 24 }}>
          <div className="field">
            <label htmlFor="order-id-input">Order Reference ID</label>
            <input
              id="order-id-input"
              type="text"
              required
              value={targetOrderId}
              onChange={e => setTargetOrderId(e.target.value)}
              placeholder="e.g. SL-5830"
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
                accept="video/*"
                style={{ display: 'none' }}
                onChange={e => {
                  if (e.target.files?.[0]) setVideoFile(e.target.files[0].name)
                }}
              />
              <span style={{ fontSize: 32 }}>📹</span>
              <p style={{ fontWeight: 600, margin: '6px 0 2px' }}>
                {videoFile ? `Attached: ${videoFile}` : 'Upload video showing intact seal opening'}
              </p>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Rule 4: continuous single-take video required for escrow refund
              </span>
            </div>
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

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button type="submit" className="btn btn-primary full" id="submit-dispute-btn">
              Lock Escrow &amp; File Claim
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
