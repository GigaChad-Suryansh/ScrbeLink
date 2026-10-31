/**
 * StepUpload.tsx  -  Step 1 of the order wizard
 * Accepts a PDF, image (JPEG/PNG/WebP) or plain text file.
 * Extracts text client-side; counts words; warns about cover/credential pages.
 */

import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icons'
import { useOrder } from '../lib/orderStore'
import { sanitizeText, wordCount } from '../lib/sanitize'
import { MIN_ORDER_MESSAGE, meetsMinimum } from '../lib/pricing'
import { detectCoverPage } from '../lib/coverPage'
import { checkFile } from '../lib/checkUpload'
import type { UploadedDoc } from '../lib/orderStore'

const ACCEPTED = '.txt,.pdf,.jpg,.jpeg,.png,.webp'
const MAX_BYTES = 20 * 1024 * 1024  // 20 MB

/** Read a text / image file and return its plain-text representation. */
async function extractText(file: File): Promise<string> {
  if (file.type === 'text/plain') {
    return file.text()
  }
  // For PDF / images we fall back to reading bytes as Latin-1 to catch any
  // ASCII-compatible text embedded in the file (e.g. PDF streams).
  // A real implementation would use pdf.js or OCR; for Phase 2 this is a stub.
  const buf = await file.arrayBuffer()
  const arr = new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < Math.min(arr.length, 50000); i++) {
    const c = arr[i]
    if (c >= 32 || c === 10 || c === 13 || c === 9) str += String.fromCharCode(c)
  }
  return str
}

export default function StepUpload() {
  const { dispatch } = useOrder()
  const nav = useNavigate()

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [doc, setDoc] = useState<UploadedDoc | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function processFile(f: File) {
    setError('')
    if (f.size > MAX_BYTES) {
      setError('File is too large (max 20 MB).')
      return
    }
    setLoading(true)
    try {
      const verdict = await checkFile(f, 'document')
      if (!verdict.ok) {
        setError(verdict.error)
        return
      }
      const raw = await extractText(f)
      const clean = sanitizeText(raw)
      const wc = wordCount(clean)
      const cover = detectCoverPage(clean)
      const d: UploadedDoc = {
        name: f.name,
        sizeBytes: f.size,
        wordCount: wc,
        hasCoverPageWarning: cover.warning,
      }
      setFile(f)
      setDoc(d)
    } catch {
      setError('Could not read the file. Try a different format.')
    } finally {
      setLoading(false)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) processFile(f)
  }

  function onNext() {
    if (!doc) return
    dispatch({ type: 'SET_DOC', doc, words: doc.wordCount })
    nav('/order/addons')
  }

  const fmt = (b: number) =>
    b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`

  return (
    <div className="wizard-step">
      <p className="eyebrow">Step 1 of 4</p>
      <h2 className="section-title">Upload your document</h2>
      <p className="section-sub" style={{ marginBottom: 28 }}>
        Accepted formats: PDF, JPEG, PNG, WebP or plain text &middot; Max 20 MB
      </p>

      {/* Drop zone */}
      <div
        className={`upload-zone card${dragging ? ' upload-zone--over' : ''}${file ? ' upload-zone--done' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
        aria-label="Upload zone - click or drag a file here"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          style={{ display: 'none' }}
          onChange={onInputChange}
          id="upload-input"
        />
        {loading ? (
          <span className="upload-zone__icon"><Icon name="clock" size={40} /></span>
        ) : file ? (
          <span className="upload-zone__icon"><Icon name="check" size={40} /></span>
        ) : (
          <span className="upload-zone__icon"><Icon name="upload" size={40} /></span>
        )}
        <p className="upload-zone__label">
          {loading
            ? 'Reading file...'
            : file
            ? file.name
            : 'Click to browse or drag a file here'}
        </p>
        {!loading && (
          <p className="upload-zone__hint">
            {file ? `${fmt(file.size)} - click to replace` : 'PDF, JPG, PNG, WebP, TXT'}
          </p>
        )}
      </div>

      {/* Error */}
      {error && <div className="alert alert--warn" role="alert">{error}</div>}

      {doc && !meetsMinimum(doc.wordCount) && (
        <div className="alert alert--warn" role="alert">
          <strong>Too short to order.</strong> {MIN_ORDER_MESSAGE} Your file has about {Math.ceil(doc.wordCount / 200)} page{Math.ceil(doc.wordCount / 200) === 1 ? '' : 's'}. Add more notes to continue.
        </div>
      )}

      {/* Cover-page warning */}
      {doc?.hasCoverPageWarning && (
        <div className="alert alert--warn" role="alert">
          <strong>Cover or credential page detected.</strong>{' '}
          ScribeLink does not transcribe title pages, submission forms, or enrollment details.
          Please remove those pages before uploading. You will still be charged only for
          content pages.
        </div>
      )}

      {/* Summary card */}
      {doc && (
        <div className="card upload-summary">
          <div className="upload-summary__row">
            <span>File</span>
            <strong>{doc.name}</strong>
          </div>
          <div className="upload-summary__row">
            <span>Size</span>
            <strong>{fmt(doc.sizeBytes)}</strong>
          </div>
          <div className="upload-summary__row">
            <span>Detected words</span>
            <strong>{doc.wordCount.toLocaleString()}</strong>
          </div>
          <div className="upload-summary__row">
            <span>Estimated pages</span>
            <strong>{doc.wordCount > 0 ? Math.ceil(doc.wordCount / 200) : '-'}</strong>
          </div>
        </div>
      )}

      <div className="wizard-nav">
        <span />
        <button
          className="btn btn-primary"
          onClick={onNext}
          disabled={!doc || !meetsMinimum(doc.wordCount)}
          id="upload-next-btn"
        >
          Next: Add-ons &amp; pen &rarr;
        </button>
      </div>
    </div>
  )
}
