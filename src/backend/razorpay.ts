/**
 * backend/razorpay.ts
 * The Razorpay side of payments: creating an order, refunding, and checking that a message
 * really came from Razorpay. Needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and
 * RAZORPAY_WEBHOOK_SECRET. The signature checks are covered by tests; the network calls
 * follow Razorpay's documented API and must be tried once against a Razorpay test account.
 */

import crypto from 'node:crypto'

const API = 'https://api.razorpay.com/v1'

export interface RazorpayConfig {
  keyId: string
  keySecret: string
  webhookSecret: string
}

export function razorpayConfig(env = process.env): RazorpayConfig | undefined {
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret, RAZORPAY_WEBHOOK_SECRET: webhookSecret } = env
  return keyId && keySecret && webhookSecret ? { keyId, keySecret, webhookSecret } : undefined
}

export const paymentProvider = (env = process.env): 'test' | 'razorpay' => (env.PAYMENT_PROVIDER === 'razorpay' ? 'razorpay' : 'test')

const hmacHex = (secret: string, data: string | Buffer) => crypto.createHmac('sha256', secret).update(data).digest('hex')

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** The browser sends this after the customer pays. Proves the payment id belongs to our order. */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature)
}

/** Razorpay signs the raw webhook body. Anything not signed with our secret is ignored. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
  return safeEqualHex(hmacHex(webhookSecret, rawBody), signature)
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>

let fetcher: Fetcher = (url, init) => fetch(url, init)
/** Tests swap the network out. */
export const setFetcher = (f: Fetcher) => { fetcher = f }

async function post(cfg: RazorpayConfig, path: string, body: unknown): Promise<any> {
  const res = await fetcher(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Razorpay ${path} failed (${res.status}): ${json?.error?.description ?? 'no detail'}`)
  return json
}

const paise = (rupees: number) => Math.round(rupees * 100)

export async function createRazorpayOrder(cfg: RazorpayConfig, amountRupees: number, receipt: string): Promise<{ id: string }> {
  return post(cfg, '/orders', { amount: paise(amountRupees), currency: 'INR', receipt })
}

/** Starts a refund. Razorpay confirms it later by webhook (refund.processed). */
export async function refundRazorpayPayment(cfg: RazorpayConfig, razorpayPaymentId: string, amountRupees: number, orderId: string): Promise<{ id: string }> {
  return post(cfg, `/payments/${razorpayPaymentId}/refund`, { amount: paise(amountRupees), notes: { orderId } })
}
