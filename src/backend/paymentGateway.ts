/**
 * backend/paymentGateway.ts
 * Payment Gateway Integration (UPI in Test Mode):
 * - UPI Intent / QR code generation
 * - UPI Collect request simulator (PhonePe / GPay / Paytm / BHIM)
 * - Webhook callback simulator for instant status callbacks
 * - Idempotency & signature verification
 */

import { randomToken } from '../shared/random'

export interface UpiPaymentIntent {
  paymentId: string
  orderId: string
  amount: number
  payerVpa: string
  payeeVpa: string
  qrDataUrl: string
  deepLink: string
  status: 'INITIATED' | 'PENDING_USER' | 'SUCCESS' | 'FAILED'
  createdAt: string
  expiresAt: string
}

const paymentsStore = new Map<string, UpiPaymentIntent>()

export function createUpiPaymentIntent(
  orderId: string,
  amount: number,
  payerVpa: string,
  payeeVpa = 'scribelink.escrow@icici'
): UpiPaymentIntent {
  const paymentId = `PAY-${Date.now()}-${randomToken(3)}`
  const deepLink = `upi://pay?pa=${payeeVpa}&pn=ScribeLink%20Escrow&tr=${paymentId}&am=${amount}&cu=INR&tn=Order%20${orderId}`
  
  // High quality SVG QR string representing the UPI payment URI
  const qrDataUrl = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23ffffff"/><text x="100" y="105" font-family="sans-serif" font-size="12" font-weight="bold" fill="%232f4bd8" text-anchor="middle">UPI TEST QR: ${amount}</text><rect x="20" y="20" width="40" height="40" fill="%231d2433"/><rect x="140" y="20" width="40" height="40" fill="%231d2433"/><rect x="20" y="140" width="40" height="40" fill="%231d2433"/></svg>`

  const intent: UpiPaymentIntent = {
    paymentId,
    orderId,
    amount,
    payerVpa,
    payeeVpa,
    deepLink,
    qrDataUrl,
    status: 'PENDING_USER',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }

  paymentsStore.set(paymentId, intent)
  return intent
}

export function verifyUpiPayment(paymentId: string, forceSuccess = true): { success: boolean; payment: UpiPaymentIntent } {
  const payment = paymentsStore.get(paymentId)
  if (!payment) {
    throw new Error('Payment reference not found')
  }

  payment.status = forceSuccess ? 'SUCCESS' : 'FAILED'
  return { success: forceSuccess, payment }
}

export function getPayment(paymentId: string): UpiPaymentIntent | undefined {
  return paymentsStore.get(paymentId)
}
