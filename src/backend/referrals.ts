/**
 * backend/referrals.ts
 * Phase 20: referral codes and customer credits.
 *
 * - Every customer gets one code. A new customer (no paid order yet) can apply someone else's code once.
 * - Applying gives the new customer a ₹50 credit, used on their next order.
 * - When that customer's first order is delivered, the referrer gets a ₹50 credit too.
 * - Credits lower what the customer pays. The scribe's payout never changes: the discount comes out
 *   of ScribeLink's share.
 * - A credit sits on a Draft order until it is paid. If the order is cancelled, or a newer order is
 *   started while the old one is still a Draft, the credit is released and can be used again.
 */

import type { Queryable } from './db'
import { randomInt, randomToken } from '../shared/random'

export const REFERRAL_CREDIT = 50
/** A referrer earns at most this many rewards, so one phone cannot farm codes. */
export const MAX_REWARDS_PER_REFERRER = 20

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L

export class ReferralError extends Error {}

function newCode(): string {
  return 'SL' + Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, '')
}

/** The customer's own code, created the first time they ask for it. */
export async function codeFor(q: Queryable, phone: string): Promise<string> {
  const have = await q.query<{ code: string }>('SELECT code FROM referral_codes WHERE phone = $1', [phone])
  if (have[0]) return have[0].code
  for (;;) {
    const code = newCode()
    const made = await q.query<{ code: string }>(
      `INSERT INTO referral_codes (phone, code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code`,
      [phone, code],
    )
    if (made[0]) return made[0].code
    // Either the code was taken or another request created this phone's code first.
    const again = await q.query<{ code: string }>('SELECT code FROM referral_codes WHERE phone = $1', [phone])
    if (again[0]) return again[0].code
  }
}

async function hasPaidOrder(q: Queryable, phone: string): Promise<boolean> {
  const r = await q.query<{ n: string }>(`SELECT count(*) AS n FROM orders WHERE customer_phone = $1 AND status <> 'Draft'`, [phone])
  return Number(r[0]?.n ?? 0) > 0
}

/** A new customer applies a friend's code. Gives them one ₹50 credit. */
export async function applyCode(q: Queryable, phone: string, rawCode: string): Promise<{ credit: number }> {
  const code = normaliseCode(rawCode)
  const owner = await q.query<{ phone: string }>('SELECT phone FROM referral_codes WHERE code = $1', [code])
  if (!owner[0]) throw new ReferralError('That referral code does not exist')
  const referrer = owner[0].phone
  if (referrer === phone) throw new ReferralError('You cannot use your own referral code')
  if (await hasPaidOrder(q, phone)) throw new ReferralError('Referral codes are only for your first order')
  const made = await q.query(
    `INSERT INTO referrals (referee_phone, referrer_phone) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING referee_phone`,
    [phone, referrer],
  )
  if (made.length === 0) throw new ReferralError('You have already used a referral code')
  await addCredit(q, phone, REFERRAL_CREDIT, `Referral code ${code}`)
  return { credit: REFERRAL_CREDIT }
}

export async function addCredit(q: Queryable, phone: string, amount: number, reason: string): Promise<void> {
  await q.query('INSERT INTO customer_credits (id, phone, amount, reason) VALUES ($1, $2, $3, $4)', [`CR-${randomToken(6)}`, phone, amount, reason])
}

/** Credits not attached to any order. */
export async function availableCredit(q: Queryable, phone: string): Promise<number> {
  const r = await q.query<{ total: string }>(
    'SELECT COALESCE(sum(amount), 0) AS total FROM customer_credits WHERE phone = $1 AND order_id IS NULL',
    [phone],
  )
  return Number(r[0]?.total ?? 0)
}

/**
 * Called inside the create-order transaction before the order row is inserted.
 * Pulls credits back from the customer's unpaid Draft orders, then attaches free credits to the new order.
 * Returns the discount. The customer always pays at least `minPayable`.
 */
export async function reserveCredit(q: Queryable, phone: string, orderId: string, total: number, minPayable: number): Promise<number> {
  const drafts = await q.query<{ order_id: string; amount: string }>(
    `SELECT c.order_id, sum(c.amount) AS amount FROM customer_credits c JOIN orders o ON o.id = c.order_id
     WHERE c.phone = $1 AND o.status = 'Draft' GROUP BY c.order_id`,
    [phone],
  )
  for (const d of drafts) {
    await q.query('UPDATE orders SET customer_total = customer_total + $2, discount = 0 WHERE id = $1', [d.order_id, Number(d.amount)])
    await q.query('UPDATE customer_credits SET order_id = NULL WHERE order_id = $1', [d.order_id])
  }
  const free = await q.query<{ id: string; amount: string }>(
    'SELECT id, amount FROM customer_credits WHERE phone = $1 AND order_id IS NULL ORDER BY created_at, id',
    [phone],
  )
  let discount = 0
  for (const c of free) {
    const amt = Number(c.amount)
    if (total - discount - amt < minPayable) break
    discount += amt
    await q.query('UPDATE customer_credits SET order_id = $2 WHERE id = $1', [c.id, orderId])
  }
  return discount
}

/** A cancelled order gives its credits back. */
export async function releaseCredit(q: Queryable, orderId: string): Promise<void> {
  await q.query('UPDATE customer_credits SET order_id = NULL WHERE order_id = $1', [orderId])
}

/** On the referee's first delivery, the referrer earns their credit. Runs once per referee. */
export async function rewardReferrer(q: Queryable, refereePhone: string | undefined, orderId: string): Promise<string | undefined> {
  if (!refereePhone) return undefined
  const ref = await q.query<{ referrer_phone: string }>(
    `UPDATE referrals SET status = 'REWARDED', rewarded_order = $2
     WHERE referee_phone = $1 AND status = 'PENDING'
       AND (SELECT count(*) FROM referrals r2 WHERE r2.referrer_phone = referrals.referrer_phone AND r2.status = 'REWARDED') < $3
     RETURNING referrer_phone`,
    [refereePhone, orderId, MAX_REWARDS_PER_REFERRER],
  )
  const referrer = ref[0]?.referrer_phone
  if (referrer) await addCredit(q, referrer, REFERRAL_CREDIT, `Friend's first order ${orderId}`)
  return referrer
}

export interface ReferralSummary {
  code: string
  credit: number
  invited: number
  rewarded: number
  usedCode: boolean
  canApplyCode: boolean
}

export async function summary(q: Queryable, phone: string): Promise<ReferralSummary> {
  const code = await codeFor(q, phone)
  const [credit, mine, used, paid] = await Promise.all([
    availableCredit(q, phone),
    q.query<{ status: string; n: string }>('SELECT status, count(*) AS n FROM referrals WHERE referrer_phone = $1 GROUP BY status', [phone]),
    q.query('SELECT 1 FROM referrals WHERE referee_phone = $1', [phone]),
    hasPaidOrder(q, phone),
  ])
  const count = (st?: string) => mine.filter((m) => !st || m.status === st).reduce((a, m) => a + Number(m.n), 0)
  return { code, credit, invited: count(), rewarded: count('REWARDED'), usedCode: used.length > 0, canApplyCode: used.length === 0 && !paid }
}
