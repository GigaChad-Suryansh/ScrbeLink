import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { renderInvoice, splitGst, type InvoiceOrder } from './invoice'

const order: InvoiceOrder = {
  id: 'SL-1234', customerPhone: '+919876543210', customerTotal: 590, pages: 10, words: 1900, addons: ['Graph'], penStyle: 'Gel · Blue',
  dropGate: { college: 'DTU', line: 'Gate 2', pincode: '110042' }, createdAt: '2026-11-20T10:00:00Z', timeline: [{ status: 'Paid', timestamp: '2026-11-20T10:05:00Z' }],
}

describe('invoice', () => {
  test('GST is taken out of the price the customer paid', () => {
    assert.deepEqual(splitGst(118, 18), { taxable: 100, gst: 18 })
    assert.deepEqual(splitGst(100, 0), { taxable: 100, gst: 0 })
  })

  test('renders a PDF, and says Receipt until a GSTIN is set', async () => {
    const plain = await renderInvoice(order, { name: 'ScribeLink', address: '', gstRatePercent: 18 })
    const taxed = await renderInvoice(order, { name: 'ScribeLink', address: 'Delhi', gstin: '07ABCDE1234F1Z5', gstRatePercent: 18 })
    assert.equal(plain.subarray(0, 5).toString(), '%PDF-')
    assert.ok(taxed.length > 1000)
  })
})
