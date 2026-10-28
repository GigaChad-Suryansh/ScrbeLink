/**
 * ScribeOnboarding.tsx
 * Scribe partner onboarding & profile verification:
 * - Contact & College registration
 * - UPI VPA configuration for automated payout settlement
 * - Handwriting sample card upload & preview
 * - Subject specialties selection
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icons'
import { api } from '../lib/api'
import { useScribePortal } from '../lib/scribeStore'
import { checkFile, uploadHint } from '../lib/checkUpload'

const SUBJECT_OPTIONS = [
  'Engineering & Tech',
  'Mathematics & Calculus',
  'Physics & Chemistry',
  'Commerce & Accounting',
  'Humanities & Social Sciences',
  'Law & Constitution',
  'Medical & Life Sciences',
  'Computer Science & Code',
]

/** The form only mounts once the saved profile has loaded, so typing is never overwritten. */
export default function ScribeOnboarding() {
  const { loading } = useScribePortal()
  return loading ? <p className="section-sub">Loading your profile…</p> : <OnboardingForm />
}

function OnboardingForm() {
  const { profile, saveProfile } = useScribePortal()
  const nav = useNavigate()

  const [name, setName] = useState(profile.name)
  const [college, setCollege] = useState(profile.college)
  const [upiVpa, setUpiVpa] = useState(profile.upiVpa)
  const [sampleText, setSampleText] = useState(profile.sampleText || '')
  const [specialties, setSpecialties] = useState<string[]>(profile.specialties)
  const [sampleImageUrl, setSampleImageUrl] = useState<string | undefined>(profile.sampleImageUrl)
  const [uploading, setUploading] = useState(false)
  const [sampleError, setSampleError] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)

  function toggleSpecialty(subj: string) {
    if (specialties.includes(subj)) {
      setSpecialties(specialties.filter(s => s !== subj))
    } else {
      setSpecialties([...specialties, subj])
    }
  }

  useEffect(() => {
    if (!savedSuccess) return
    const t = setTimeout(() => nav('/scribe/dashboard'), 1500)
    return () => clearTimeout(t)
  }, [savedSuccess, nav])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setSaving(true)
    const err = await saveProfile({ name, college, upiVpa, sampleText, specialties, sampleImageUrl })
    setSaving(false)
    if (err) return setFormError(err)
    setSavedSuccess(true)
  }

  async function onSamplePicked(input: HTMLInputElement) {
    const f = input.files?.[0]
    if (!f) return
    setSampleError('')
    const verdict = await checkFile(f, 'image')
    if (!verdict.ok) {
      setSampleError(verdict.error)
      input.value = ''
      return
    }
    setUploading(true)
    try {
      const r = await api<{ url: string }>('POST', '/api/uploads/sample', { as: 'scribe', raw: f, headers: { 'x-file-name': encodeURIComponent(f.name) } })
      setSampleImageUrl(r.url)
    } catch (e) {
      setSampleError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-header">
        <span className="eyebrow">Scribe Network Onboarding</span>
        <h1 className="section-title">Verified Scribe Profile &amp; Payout Setup</h1>
        <p className="section-sub">
          Complete your profile to receive nearby transcription assignments. Orders settle directly into your UPI address.
        </p>
      </div>

      <form onSubmit={handleSave} className="onboarding-form-grid">
        {/* Left Column: Form Details */}
        <div className="card form-column">
          <h3 className="form-section-title">1. Personal &amp; Campus Verification</h3>
          
          <div className="field">
            <label htmlFor="scribe-name">Full Legal Name</label>
            <input
              id="scribe-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="field">
            <label htmlFor="scribe-college">College / University Campus</label>
            <input
              id="scribe-college"
              type="text"
              required
              value={college}
              onChange={e => setCollege(e.target.value)}
              placeholder="e.g. DTU, IIT Delhi, DU North Campus"
            />
          </div>

          <h3 className="form-section-title" style={{ marginTop: 24 }}>2. Payout Destination (UPI VPA)</h3>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            Escrow earnings are automatically dispatched to this UPI ID upon 24-hour delivery sign-off.
          </p>

          <div className="field">
            <label htmlFor="scribe-upi">UPI VPA Address</label>
            <input
              id="scribe-upi"
              type="text"
              required
              value={upiVpa}
              onChange={e => setUpiVpa(e.target.value)}
              placeholder="yourname@okaxis or yourname@paytm"
            />
          </div>

          <h3 className="form-section-title" style={{ marginTop: 24 }}>3. Subject Specialties</h3>
          <div className="specialties-grid">
            {SUBJECT_OPTIONS.map(subj => {
              const selected = specialties.includes(subj)
              return (
                <button
                  type="button"
                  key={subj}
                  onClick={() => toggleSpecialty(subj)}
                  className={`chip-button ${selected ? 'chip-button--active' : ''}`}
                >
                  {subj}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right Column: Handwriting Card Preview */}
        <div className="form-column">
          <div className="card sample-card-builder">
            <h3 className="form-section-title">4. Handwriting Sample Card</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Customers browse scribes primarily by this card. Upload a photo or write your signature excerpt.
            </p>

            <div className="sample-upload-zone" onClick={() => document.getElementById('sample-file-input')?.click()}>
              <input
                id="sample-file-input"
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                style={{ display: 'none' }}
                onChange={e => onSamplePicked(e.target)}
              />
              {sampleImageUrl ? (
                <img src={sampleImageUrl} alt="Your handwriting sample" style={{ maxHeight: 140, borderRadius: 10 }} />
              ) : (
                <span style={{ color: 'var(--muted)' }}><Icon name="camera" size={30} /></span>
              )}
              <p style={{ fontWeight: 600, margin: '6px 0 2px' }}>
                {uploading ? 'Uploading…' : sampleImageUrl ? 'Sample photo uploaded' : 'Upload a photo of your handwriting'}
              </p>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Click to {sampleImageUrl ? 'replace' : 'choose'} the photo. {uploadHint('image')}.</span>
            </div>
            {sampleError && <p role="alert" style={{ color: 'var(--warn)', fontSize: 13, marginTop: 6 }}>{sampleError}</p>}

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="sample-text">Sample Excerpt Text</label>
              <textarea
                id="sample-text"
                rows={3}
                value={sampleText}
                onChange={e => setSampleText(e.target.value)}
                placeholder="Write sample transcript sentence..."
                className="text-area-input"
              />
            </div>

            {/* Live Customer Preview of Sample Card */}
            <div style={{ marginTop: 16 }}>
              <span className="card-preview-tag">Customer View Preview:</span>
              <div className="paper sample-live-card">
                <div className="paper-margin" />
                <p className="scribble font-caveat">{sampleText || 'Write neat notes for your peers.'}</p>
                <div className="paper-tag">Sample card · {name || 'Your name'}</div>
              </div>
            </div>

            {savedSuccess && (
              <div className="alert alert--ok" style={{ marginTop: 16 }}>
                Saved. An admin will review your handwriting card; you can take orders once it is approved.
              </div>
            )}
            {formError && <div className="alert alert--warn" role="alert" style={{ marginTop: 16 }}>{formError}</div>}

            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="submit" className="btn btn-primary full" id="save-scribe-profile" disabled={saving || uploading}>
                {saving ? 'Saving…' : 'Save & submit for approval'}
              </button>
              <Link to="/scribe/dashboard" className="btn btn-ghost full" style={{ marginTop: 8, textAlign: 'center' }}>
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
