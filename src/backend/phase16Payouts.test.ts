/**
 * phase16Payouts.test.ts
 * Phase 16: Tests for PAN encryption, TDS calculation, payout routing,
 * capacity controls, and earnings statements.
 */

import './testSetup'
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { createApp } from './server'
import { testDb } from './testDb'
import {
  encryptPan, decryptPan, panLast4, validatePan,
  financialYear, calcTds, TDS_RATE, TDS_THRESHOLD_YEARLY,
  issuePayout, setPayoutFetcher,
  type RazorpayXConfig,
} from './payouts'

// ── PAN encryption ────────────────────────────────────────────────────────────

describe('PAN encryption', () => {
  beforeEach(() => {
    process.env.SCRIBE_PAN_KEY = 'a'.repeat(64)
  })

  test('round-trips a valid PAN', () => {
    const pan = 'ABCDE1234F'
    const blob = encryptPan(pan)
    assert.equal(decryptPan(blob), pan)
  })

  test('produces different ciphertext on each call (random IV)', () => {
    const pan = 'ABCDE1234F'
    const b1 = encryptPan(pan)
    const b2 = encryptPan(pan)
    assert.notEqual(b1, b2)
  })

  test('panLast4 returns the last 4 chars', () => {
    assert.equal(panLast4('ABCDE1234F'), '234F')
  })
})

describe('validatePan', () => {
  const cases: Array<[string, boolean]> = [
    ['ABCDE1234F', true],
    ['abcde1234f', true],
    ['ABCDE12345', false],
    ['AB1DE1234F', false],
    ['ABCDE1234', false],
  ]
  for (const [pan, expected] of cases) {
    test(`${pan} -> ${expected}`, () => {
      assert.equal(validatePan(pan), expected)
    })
  }
})

// ── TDS ───────────────────────────────────────────────────────────────────────

describe('financialYear', () => {
  test('April 2025 -> 2025-26', () => {
    assert.equal(financialYear(new Date('2025-04-01')), '2025-26')
  })
  test('March 2026 -> 2025-26', () => {
    assert.equal(financialYear(new Date('2026-03-31')), '2025-26')
  })
  test('January 2026 -> 2025-26', () => {
    assert.equal(financialYear(new Date('2026-01-15')), '2025-26')
  })
  test('April 2026 -> 2026-27', () => {
    assert.equal(financialYear(new Date('2026-04-01')), '2026-27')
  })
})

describe('calcTds', () => {
  test('no TDS when YTD stays below threshold', () => {
    const r = calcTds(10_000, 15_000)
    assert.equal(r.tdsAmount, 0)
    assert.equal(r.netAmount, 10_000)
  })

  test('TDS on the portion that crosses the threshold', () => {
    const r = calcTds(10_000, 25_000)
    const expectedTds = Math.round(5_000 * TDS_RATE * 100) / 100
    assert.equal(r.tdsAmount, expectedTds)
    assert.ok(Math.abs(r.netAmount - (10_000 - expectedTds)) < 0.01)
  })

  test('full TDS when already above threshold', () => {
    const r = calcTds(5_000, 50_000)
    const expectedTds = Math.round(5_000 * TDS_RATE * 100) / 100
    assert.equal(r.tdsAmount, expectedTds)
  })

  test('no TDS for a nil withdrawal', () => {
    const r = calcTds(0, 0)
    assert.equal(r.tdsAmount, 0)
  })

  test('TDS_THRESHOLD_YEARLY is 30000', () => {
    assert.equal(TDS_THRESHOLD_YEARLY, 30_000)
  })
})

// ── RazorpayX payout adapter ──────────────────────────────────────────────────

describe('issuePayout — simulated fallback', () => {
  test('returns simulated result when no config provided', async () => {
    const r = await issuePayout(undefined, 'scribe1', 'Alice', '9999999999', 'alice@upi', 500, 'TX-001')
    assert.equal(r.provider, 'simulated')
    assert.equal(r.status, 'processed')
    assert.equal(r.failureReason, null)
  })
})

describe('issuePayout — RazorpayX happy path', () => {
  const cfg: RazorpayXConfig = {
    keyId: 'rzpx_test_key',
    keySecret: 'secret',
    accountNumber: '1234567890',
  }

  beforeEach(() => {
    let call = 0
    setPayoutFetcher(async () => {
      call++
      if (call === 1) return { ok: true, status: 200, json: async () => ({ id: 'cont_1' }) }
      if (call === 2) return { ok: true, status: 200, json: async () => ({ id: 'fa_1' }) }
      return { ok: true, status: 200, json: async () => ({ id: 'pout_1', status: 'processing' }) }
    })
  })

  test('issues via RazorpayX and returns pending status', async () => {
    const r = await issuePayout(cfg, 'scribe1', 'Alice', '9999999999', 'alice@upi', 500, 'TX-001')
    assert.equal(r.provider, 'razorpayx')
    assert.equal(r.providerRef, 'pout_1')
    assert.equal(r.status, 'pending')
    assert.equal(r.failureReason, null)
  })
})

describe('issuePayout — RazorpayX failure', () => {
  const cfg: RazorpayXConfig = {
    keyId: 'rzpx_test_key',
    keySecret: 'secret',
    accountNumber: '1234567890',
  }

  beforeEach(() => {
    setPayoutFetcher(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { description: 'Insufficient funds' } }),
    }))
  })

  test('returns failed status and captures the reason', async () => {
    const r = await issuePayout(cfg, 'scribe1', 'Alice', '9999999999', 'alice@upi', 500, 'TX-002')
    assert.equal(r.status, 'failed')
    assert.ok(r.failureReason?.includes('Insufficient funds'))
  })
})

// ── End-to-end API routes ─────────────────────────────────────────────────────

describe('Phase 16 API routes', () => {
  let server: Server
  let base = ''
  let db: Awaited<ReturnType<typeof testDb>>

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, data: (await res.json()) as any }
  }

  const login = async (phone: string, requestedRole: 'scribe' | 'admin') => {
    const send = await call('POST', '/api/auth/otp/send', undefined, { phone })
    const verify = await call('POST', '/api/auth/otp/verify', undefined, { phone, otp: send.data.devOtp, requestedRole })
    return verify.data.token as string
  }

  before(async () => {
    process.env.SCRIBE_PAN_KEY = 'b'.repeat(64)
    db = await testDb()
    server = createApp(db).listen(0)
    const addr = server.address() as { port: number }
    base = `http://127.0.0.1:${addr.port}`
  })

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await db.close()
  })

  test('scribe can save capacity, verification docs (encrypted PAN), and fetch statement', async () => {
    const scribeToken = await login('+919876543210', 'scribe')
    const adminToken = await login('+919000000001', 'admin')

    // Create scribe profile first
    const prof = await call('PUT', '/api/scribe/me', scribeToken, {
      name: 'Test Scribe',
      college: 'DTU',
      sampleText: 'A neat sample sentence for verification.',
      upiVpa: 'scribe@okaxis',
      specialties: ['Mathematics & Calculus'],
    })
    assert.equal(prof.status, 200)
    const scribeId = prof.data.profile.id as string

    // Capacity controls
    const cap = await call('PUT', '/api/scribe/capacity', scribeToken, { maxPagesToday: 40, onVacation: true })
    assert.equal(cap.status, 200)
    assert.equal(cap.data.maxPagesToday, 40)
    assert.equal(cap.data.onVacation, true)

    // Verification (PAN + college ID + selfie)
    const ver = await call('PUT', '/api/scribe/verification', scribeToken, {
      pan: 'abcde1234f',
      collegeIdUrl: '/api/samples/0123456789abcdef0123456789abcdef',
      selfieUrl: '/api/samples/fedcba9876543210fedcba9876543210',
    })
    assert.equal(ver.status, 200)
    assert.equal(ver.data.panLast4, '234F')
    assert.equal(ver.data.idVerified, false)

    // Admin verifies ID
    const admVer = await call('POST', `/api/admin/scribes/${scribeId}/verify-id`, adminToken, { idVerified: true })
    assert.equal(admVer.status, 200)
    assert.equal(admVer.data.idVerified, true)

    // Statement (empty initially)
    const stmt = await call('GET', '/api/scribe/statement', scribeToken)
    assert.equal(stmt.status, 200)
    assert.deepEqual(stmt.data.statement, [])
  })
})
