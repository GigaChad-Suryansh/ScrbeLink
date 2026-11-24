/**
 * backend/invoice.ts
 * A one-page PDF for a paid order. It is titled "Tax invoice" only when the business GSTIN is
 * configured; otherwise it is a plain receipt. The GST rate and wording must be confirmed with an
 * accountant before launch (see ANTIGRAVITY_ROADMAP.md, Phase 12).
 */

import PDFDocument from 'pdfkit'
import { REFUND_REASON_TEXT, type RefundReason } from '../shared/refunds'

export interface InvoiceOrder {
  id: string
  customerPhone?: string
  customerTotal: number
  pages: number
  words: number
  addons: string[]
  penStyle: string
  dropGate?: { college: string; line: string; pincode: string }
  createdAt: string
  timeline: Array<{ status: string; timestamp: string }>
}

export interface InvoiceRefund { amount: number; reason: RefundReason; status: string; createdAt: string }

export interface Seller { name: string; address: string; gstin?: string; gstRatePercent: number }

export function sellerFromEnv(env = process.env): Seller {
  const rate = Number(env.GST_RATE ?? 18)
  return {
    name: env.BUSINESS_NAME || 'ScribeLink',
    address: env.BUSINESS_ADDRESS || '',
    gstin: env.BUSINESS_GSTIN || undefined,
    gstRatePercent: Number.isFinite(rate) && rate >= 0 ? rate : 18,
  }
}

const rupees = (n: number) => `Rs. ${n.toFixed(2)}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** Tax is included in the price the customer paid. */
export function splitGst(total: number, ratePercent: number): { taxable: number; gst: number } {
  const taxable = Math.round((total / (1 + ratePercent / 100)) * 100) / 100
  return { taxable, gst: Math.round((total - taxable) * 100) / 100 }
}

export function renderInvoice(order: InvoiceOrder, seller: Seller, refund?: InvoiceRefund): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Invoice ${order.id}`, Author: seller.name } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const paidAt = order.timeline.find((t) => t.status === 'Paid')?.timestamp ?? order.createdAt
    const title = seller.gstin ? 'Tax invoice' : 'Receipt'

    doc.fontSize(20).font('Helvetica-Bold').text(seller.name)
    doc.fontSize(10).font('Helvetica').fillColor('#555555')
    if (seller.address) doc.text(seller.address)
    if (seller.gstin) doc.text(`GSTIN: ${seller.gstin}`)
    doc.moveDown(1.5).fillColor('#000000').fontSize(16).font('Helvetica-Bold').text(title)
    doc.fontSize(10).font('Helvetica').moveDown(0.5)
    doc.text(`Number: ${order.id}`)
    doc.text(`Date: ${day(paidAt)}`)
    if (order.customerPhone) doc.text(`Customer: mobile ending ${order.customerPhone.slice(-4)}`)
    if (order.dropGate) doc.text(`Delivered to: ${order.dropGate.line}, ${order.dropGate.college} ${order.dropGate.pincode}`)

    doc.moveDown(1.5)
    const y = doc.y
    doc.font('Helvetica-Bold').text('Description', 56, y).text('Amount', 400, y, { width: 139, align: 'right' })
    doc.moveTo(56, y + 16).lineTo(539, y + 16).strokeColor('#cccccc').stroke()
    doc.font('Helvetica').text(`Handwritten transcription, ${order.pages} pages (${order.words.toLocaleString('en-IN')} words)`, 56, y + 26, { width: 330 })
    doc.text(rupees(order.customerTotal), 400, y + 26, { width: 139, align: 'right' })
    const extras = [...order.addons, order.penStyle.replace(/\s*·\s*/g, ' - ')].filter(Boolean).join(', ')
    if (extras) doc.fillColor('#555555').fontSize(9).text(`Includes: ${extras}`, 56, doc.y + 4, { width: 330 }).fillColor('#000000').fontSize(10)

    doc.moveDown(2)
    const line = (label: string, value: string, bold = false) => {
      const top = doc.y
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 280, top, { width: 120 }).text(value, 400, top, { width: 139, align: 'right' })
      doc.moveDown(0.4)
    }
    if (seller.gstin) {
      const { taxable, gst } = splitGst(order.customerTotal, seller.gstRatePercent)
      line('Taxable value', rupees(taxable))
      line(`GST at ${seller.gstRatePercent}%`, rupees(gst))
    }
    line('Total paid', rupees(order.customerTotal), true)

    if (refund) {
      doc.x = 56
      doc.moveDown(1).font('Helvetica-Bold').text('Refund')
      doc.font('Helvetica').text(`${rupees(refund.amount)} on ${day(refund.createdAt)}: ${REFUND_REASON_TEXT[refund.reason]}.`)
      doc.text(refund.status === 'PROCESSED' ? 'Status: sent to your payment account.' : 'Status: on its way to your payment account.')
    }

    doc.fontSize(8).fillColor('#777777').text('Payment is held in escrow until your notes are delivered. Questions: contact ScribeLink support with your order number.', 56, 760, { width: 483 })
    doc.end()
  })
}
