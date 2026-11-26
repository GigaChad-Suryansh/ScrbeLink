/**
 * backend/payouts.ts
 * Phase 16: Real payout support via RazorpayX (or simulated fallback),
 * PAN encryption/decryption, TDS calculation, and monthly earnings statements.
 *
 * PAN encryption: AES-256-GCM. The key is SCRIBE_PAN_KEY (32 bytes hex).
 * Never log or return the plaintext PAN; only the last-4 for display.
 *
 * TDS rules (Indian IT Act):
 *   - Section 194H (commission) applies when total payout in a financial year > ₹30,000
 *   - Rate: 5% (we apply 10% to stay safe — confirm with CA before launch)
 *   - Financial year runs April–March
 *
 * RazorpayX payout API:
 *   POST https://api.razorpay.com/v1/payouts
 *   Auth: Basic <RAZORPAYХ_KEY_ID>:<RAZORPAYX_KEY_SECRET>
 *   Needs: fund_account_id (created once per scribe), purpose='payout', amount in paise
 */

import crypto from 'node:crypto'
import type { Queryable } from './db'

// ── Constants ─────────────────────────────────────────────────────────────────

/** TDS rate. Confirm with a CA before launch. */
export const TDS_RATE = 0.10
/** Annual threshold above which TDS applies (₹30,000). */
export const TDS_THRESHOLD_YEARLY = 30_000

const RAZORPAYX_API = 'https://api.razorpay.com/v1'

// ── PAN encryption ────────────────────────────────────────────────────────────

function panKey(): Buffer {
  const hex = process.env.SCRIBE_PAN_KEY ?? ''
  if (hex.length !== 64) throw new Error('SCRIBE_PAN_KEY must be 64 hex chars (32 bytes)')
  return Buffer.from(hex, 'hex')
}

/** Encrypts a PAN string. Returns a base64 string: iv:ciphertext:authTag */
export function encryptPan(pan: string): string {
  const key = panKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(pan, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`
}

/** Decrypts the stored blob. Returns the plaintext PAN. */
export function decryptPan(blob: string): string {
  const key = panKey()
  const [ivB64, encB64, tagB64] = blob.split(':')
  if (!ivB64 || !encB64 || !tagB64) throw new Error('Invalid PAN blob')
  const iv = Buffer.from(ivB64, 'base64')
  const enc = Buffer.from(encB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

export function panLast4(pan: string): string {
  return pan.slice(-4).toUpperCase()
}

export function validatePan(pan: string): boolean {
  // Indian PAN: 5 letters, 4 digits, 1 letter — case-insensitive
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(pan.trim())
}

// ── TDS calculation ───────────────────────────────────────────────────────────

/** Returns "YYYY-YY" string for the Indian financial year of a given date. */
export function financialYear(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1 // 1-based
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`
  return `${y - 1}-${String(y).slice(-2)}`
}

export interface TdsResult {
  grossAmount: number
  tdsAmount: number
  netAmount: number
}

/**
 * Calculates TDS for a withdrawal of `amount` given the scribe's existing
 * year-to-date gross payments `ytdGross`.
 */
export function calcTds(amount: number, ytdGross: number): TdsResult {
  const grossAfter = ytdGross + amount
  const prevTdsable = Math.max(0, ytdGross - TDS_THRESHOLD_YEARLY)
  const nowTdsable = Math.max(0, grossAfter - TDS_THRESHOLD_YEARLY)
  const tdsAmount = Math.round((nowTdsable - prevTdsable) * TDS_RATE * 100) / 100
  return { grossAmount: amount, tdsAmount, netAmount: Math.round((amount - tdsAmount) * 100) / 100 }
}

/** Upserts the TDS record for the scribe in the current financial year. */
export async function recordTds(q: Queryable, scribeId: string, gross: number, tds: number): Promise<void> {
  const fy = financialYear()
  await q.query(
    `INSERT INTO tds_records (scribe_id, fy, gross_paid, tds_deducted, updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (scribe_id, fy) DO UPDATE
     SET gross_paid    = tds_records.gross_paid    + EXCLUDED.gross_paid,
         tds_deducted  = tds_records.tds_deducted  + EXCLUDED.tds_deducted,
         updated_at    = now()`,
    [scribeId, fy, gross, tds],
  )
}

/** Returns the YTD gross for the current financial year (for TDS calculation). */
export async function ytdGross(q: Queryable, scribeId: string): Promise<number> {
  const fy = financialYear()
  const r = await q.query<{ gross_paid: string }>(
    'SELECT gross_paid FROM tds_records WHERE scribe_id=$1 AND fy=$2',
    [scribeId, fy],
  )
  return r[0] ? Number(r[0].gross_paid) : 0
}

// ── Monthly earnings statement ────────────────────────────────────────────────

export interface MonthStatement {
  month: string        // "YYYY-MM"
  grossPaid: number
  tdsDeducted: number
  netPaid: number
  transactionCount: number
}

export async function monthlyStatement(q: Queryable, scribeId: string): Promise<MonthStatement[]> {
  const rows = await q.query<{
    month: string
    gross: string
    tds: string
    net: string
    n: string
  }>(
    `SELECT
       to_char(created_at, 'YYYY-MM') AS month,
       sum(amount)                    AS gross,
       sum(tds_amount)                AS tds,
       sum(amount - tds_amount)       AS net,
       count(*)                       AS n
     FROM withdrawals
     WHERE scribe_id = $1
     GROUP BY to_char(created_at, 'YYYY-MM')
     ORDER BY month DESC
     LIMIT 24`,
    [scribeId],
  )
  return rows.map((r) => ({
    month: r.month,
    grossPaid: Number(r.gross),
    tdsDeducted: Number(r.tds),
    netPaid: Number(r.net),
    transactionCount: Number(r.n),
  }))
}

// ── RazorpayX payout ──────────────────────────────────────────────────────────

export interface RazorpayXConfig {
  keyId: string
  keySecret: string
  accountNumber: string   // RazorpayX current account number
}

export function razorpayXConfig(env = process.env): RazorpayXConfig | undefined {
  const { RAZORPAYX_KEY_ID: keyId, RAZORPAYX_KEY_SECRET: keySecret, RAZORPAYX_ACCOUNT: accountNumber } = env
  return keyId && keySecret && accountNumber ? { keyId, keySecret, accountNumber } : undefined
}

export type PayoutFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

let payoutFetcher: PayoutFetcher = (url, init) => fetch(url, init)
/** Tests swap the network out. */
export const setPayoutFetcher = (f: PayoutFetcher) => { payoutFetcher = f }

async function xPost(cfg: RazorpayXConfig, path: string, body: unknown): Promise<Record<string, unknown>> {
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')
  const res = await payoutFetcher(`${RAZORPAYX_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    const desc = (json?.error as Record<string, unknown>)?.description ?? 'no detail'
    throw new Error(`RazorpayX ${path} failed (${res.status}): ${desc}`)
  }
  return json
}

/**
 * Creates a RazorpayX contact + fund account for the scribe (idempotent via
 * `reference_id`). Returns the fund_account_id needed for payouts.
 */
export async function ensureFundAccount(
  cfg: RazorpayXConfig,
  scribeId: string,
  name: string,
  phone: string,
  upiVpa: string,
): Promise<string> {
  // 1. Create or fetch contact
  const contact = await xPost(cfg, '/contacts', {
    name,
    contact: phone.startsWith('+') ? phone : `+91${phone}`,
    type: 'vendor',
    reference_id: `scribe_${scribeId}`,
  }) as { id: string }

  // 2. Create fund account (UPI VPA)
  const fa = await xPost(cfg, '/fund_accounts', {
    contact_id: contact.id,
    account_type: 'vpa',
    vpa: { address: upiVpa },
  }) as { id: string }

  return fa.id
}

export interface PayoutResult {
  provider: 'razorpayx' | 'simulated'
  providerRef: string | null
  status: 'processed' | 'pending' | 'failed'
  failureReason: string | null
}

/**
 * Issues a payout of `amountRupees` (net of TDS) to the scribe's UPI VPA.
 * Falls back to simulated if no RazorpayX config is present.
 */
export async function issuePayout(
  cfg: RazorpayXConfig | undefined,
  scribeId: string,
  name: string,
  phone: string,
  upiVpa: string,
  amountRupees: number,
  idempotencyKey: string,
): Promise<PayoutResult> {
  if (!cfg) {
    // No live config — record as simulated, same as before Phase 16.
    return { provider: 'simulated', providerRef: null, status: 'processed', failureReason: null }
  }

  try {
    const fundAccountId = await ensureFundAccount(cfg, scribeId, name, phone, upiVpa)
    const payout = await xPost(cfg, '/payouts', {
      account_number: cfg.accountNumber,
      fund_account_id: fundAccountId,
      amount: Math.round(amountRupees * 100), // paise
      currency: 'INR',
      mode: 'UPI',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: idempotencyKey,
      narration: `ScribeLink payout ${idempotencyKey}`,
    }) as { id: string; status: string }

    return {
      provider: 'razorpayx',
      providerRef: payout.id,
      status: payout.status === 'processed' ? 'processed' : 'pending',
      failureReason: null,
    }
  } catch (e) {
    return {
      provider: 'razorpayx',
      providerRef: null,
      status: 'failed',
      failureReason: (e as Error).message,
    }
  }
}

