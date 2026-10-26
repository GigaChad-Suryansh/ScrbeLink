/**
 * backend/paymentGateway.ts
 * UPI payment intents in test mode. No real money moves. The server stores each intent
 * (see the payments table) and decides the outcome; swap this file for a real gateway later.
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

export function createUpiPaymentIntent(
  orderId: string,
  amount: number,
  payerVpa: string,
  payeeVpa = 'scribelink.escrow@icici',
): UpiPaymentIntent {
  const paymentId = `PAY-${Date.now()}-${randomToken(3)}`
  const deepLink = `upi://pay?pa=${payeeVpa}&pn=ScribeLink%20Escrow&tr=${paymentId}&am=${amount}&cu=INR&tn=Order%20${orderId}`

  // A placeholder picture standing in for a real UPI QR code.
  const qrDataUrl = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23ffffff"/><text x="100" y="105" font-family="sans-serif" font-size="12" font-weight="bold" fill="%232f4bd8" text-anchor="middle">UPI TEST QR: ${amount}</text><rect x="20" y="20" width="40" height="40" fill="%231d2433"/><rect x="140" y="20" width="40" height="40" fill="%231d2433"/><rect x="20" y="140" width="40" height="40" fill="%231d2433"/></svg>`

  return {
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
}
