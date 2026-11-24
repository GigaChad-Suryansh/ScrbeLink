/**
 * razorpayCheckout.ts
 * Opens Razorpay's payment window. The script is loaded from Razorpay only when a customer pays.
 * Not exercised by automated tests: try it once with a Razorpay test account.
 */

interface RazorpayResult { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
interface RazorpayInstance { open(): void; on(event: string, handler: (r: { error?: { description?: string } }) => void): void }
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance } }

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = SCRIPT
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'))
    document.head.appendChild(el)
  })
}

export async function payWithRazorpay(o: { keyId: string; rzpOrderId: string; amountRupees: number; description: string; contact?: string }): Promise<RazorpayResult> {
  await loadScript()
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay!({
      key: o.keyId,
      order_id: o.rzpOrderId,
      amount: Math.round(o.amountRupees * 100),
      currency: 'INR',
      name: 'ScribeLink',
      description: o.description,
      prefill: o.contact ? { contact: o.contact } : undefined,
      theme: { color: '#0066cc' },
      handler: (r: RazorpayResult) => resolve(r),
      modal: { ondismiss: () => reject(new Error('Payment cancelled. You have not been charged.')) },
    })
    rz.on('payment.failed', (r) => reject(new Error(r.error?.description ?? 'Payment failed. You have not been charged.')))
    rz.open()
  })
}
