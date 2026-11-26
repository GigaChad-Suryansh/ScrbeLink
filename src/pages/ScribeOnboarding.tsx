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
import PickupCard from '../components/PickupCard'

/** Phase 16: PAN and ID verification panel */
function VerificationPanel() {
  const [pan, setPan] = useState('')
  const [collegeIdUrl, setCollegeIdUrl] = useState('')
  const [selfieUrl, setSelfieUrl] = useState('')
  const [panLast4, setPanLast4] = useState('')
  const [uploading, setUploading] = useState<'college' | 'selfie' | null>(null)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function uploadMedia(file: File, type: 'college' | 'selfie') {
    setUploading(type); setErr('')
    try {
      const r = await api<{ url: string }>('POST', '/api/uploads/sample', {
        as: 'scribe', raw: file, headers: { 'x-file-name': encodeURIComponent(file.name) },
      })
      if (type === 'college') setCollegeIdUrl(r.url)
      else setSelfieUrl(r.url)
    } catch (e) { setErr((e as Error).message) }
    finally { setUploading(null) }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!collegeIdUrl || !selfieUrl) { setErr('Upload both your college ID and a selfie first'); return }
    setSaving(true); setErr('')
    try {
      const r = await api<{ panLast4: string }>('PUT', '/api/scribe/verification', {
        as: 'scribe', body: { pan, collegeIdUrl, selfieUrl },
      })
      setPanLast4(r.panLast4)
      setSaved(true)
    } catch (e) { setErr((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="card form-column" style={{ marginTop: 24 }}>
      <h3 className="form-section-title">5. Identity verification (Phase 16)</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
        Required before real payouts. Your PAN is stored encrypted; only the last 4 digits are visible after saving.
        An admin will verify your documents before marking you as ID-verified.
      </p>

      {saved && (
        <div className="alert alert--ok" style={{ marginBottom: 14 }}>
          Verification documents submitted. PAN ending in <strong>…{panLast4}</strong> recorded.
          An admin will review shortly.
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="field">
          <label htmlFor="pan-input">PAN (e.g. ABCDE1234F)</label>
          <input
            id="pan-input"
            type="text"
            maxLength={10}
            required
            value={pan}
            onChange={e => setPan(e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            autoComplete="off"
          />
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label>College ID photo</label>
          <div
            className="sample-upload-zone"
            style={{ cursor: 'pointer' }}
            onClick={() => document.getElementById('college-id-input')?.click()}
          >
            <input id="college-id-input" type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadMedia(f, 'college') }} />
            {collegeIdUrl
              ? <img src={collegeIdUrl} alt="College ID" style={{ maxHeight: 100, borderRadius: 8 }} />
              : <span style={{ color: 'var(--muted)' }}><Icon name="camera" size={24} /></span>}
            <p style={{ fontWeight: 600, margin: '4px 0 2px' }}>
              {uploading === 'college' ? 'Uploading…' : collegeIdUrl ? 'ID uploaded' : 'Upload college ID'}
            </p>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{uploadHint('image')}</span>
          </div>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label>Selfie</label>
          <div
            className="sample-upload-zone"
            style={{ cursor: 'pointer' }}
            onClick={() => document.getElementById('selfie-input')?.click()}
          >
            <input id="selfie-input" type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadMedia(f, 'selfie') }} />
            {selfieUrl
              ? <img src={selfieUrl} alt="Selfie" style={{ maxHeight: 100, borderRadius: 8 }} />
              : <span style={{ color: 'var(--muted)' }}><Icon name="camera" size={24} /></span>}
            <p style={{ fontWeight: 600, margin: '4px 0 2px' }}>
              {uploading === 'selfie' ? 'Uploading…' : selfieUrl ? 'Selfie uploaded' : 'Upload a selfie'}
            </p>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{uploadHint('image')}</span>
          </div>
        </div>

        {err && <p role="alert" style={{ color: 'var(--warn)', fontSize: 13, marginTop: 8 }}>{err}</p>}

        <button
          type="submit"
          className="btn btn-primary full"
          style={{ marginTop: 16 }}
          disabled={saving || !!uploading}
        >
          {saving ? 'Saving…' : 'Submit for ID verification'}
        </button>
      </form>
      <VerificationPanel />
    </div>
  )
}

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

      <PickupCard />

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
      <VerificationPanel />
    </div>
  )
}
