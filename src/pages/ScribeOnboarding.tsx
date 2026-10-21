/**
 * ScribeOnboarding.tsx
 * Scribe partner onboarding & profile verification:
 * - Contact & College registration
 * - UPI VPA configuration for automated payout settlement
 * - Handwriting sample card upload & preview
 * - Subject specialties selection
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useScribePortal } from '../lib/scribeStore'

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

export default function ScribeOnboarding() {
  const { profile, updateProfile } = useScribePortal()
  const nav = useNavigate()

  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone)
  const [college, setCollege] = useState(profile.college)
  const [upiVpa, setUpiVpa] = useState(profile.upiVpa)
  const [sampleText, setSampleText] = useState(profile.sampleText || "Newton's second law: F = ma. The acceleration of a body is directly proportional to the net force.")
  const [specialties, setSpecialties] = useState<string[]>(profile.specialties)
  const [sampleFileName, setSampleFileName] = useState<string>('sample_card_dtu.jpg')
  const [savedSuccess, setSavedSuccess] = useState(false)

  function toggleSpecialty(subj: string) {
    if (specialties.includes(subj)) {
      setSpecialties(specialties.filter(s => s !== subj))
    } else {
      setSpecialties([...specialties, subj])
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    updateProfile({
      name,
      phone,
      college,
      upiVpa,
      sampleText,
      specialties,
      isApproved: true,
    })
    setSavedSuccess(true)
    setTimeout(() => {
      nav('/scribe/dashboard')
    }, 1200)
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
            <label htmlFor="scribe-phone">WhatsApp / Phone Number</label>
            <input
              id="scribe-phone"
              type="text"
              required
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
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
                  {selected ? '✓ ' : '+ '} {subj}
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
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={e => {
                  if (e.target.files?.[0]) setSampleFileName(e.target.files[0].name)
                }}
              />
              <span style={{ fontSize: 28 }}>🖋️</span>
              <p style={{ fontWeight: 600, margin: '6px 0 2px' }}>
                {sampleFileName ? `File: ${sampleFileName}` : 'Upload handwritten sample image'}
              </p>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Click to replace sample image</span>
            </div>

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
                <div className="paper-tag">Sample card · {name} ({college.split(' ')[0]})</div>
              </div>
            </div>

            {savedSuccess && (
              <div className="alert alert--ok" style={{ marginTop: 16 }}>
                ✓ Profile &amp; UPI settings saved! Redirecting to Scribe Dashboard...
              </div>
            )}

            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="submit" className="btn btn-primary full" id="save-scribe-profile">
                Save &amp; Activate Scribe Profile
              </button>
              <Link to="/scribe/dashboard" className="btn btn-ghost full" style={{ marginTop: 8, textAlign: 'center' }}>
                Cancel &amp; Go to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
