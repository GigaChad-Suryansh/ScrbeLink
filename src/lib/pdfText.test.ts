import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readPdfText, scannedPages, type PdfJs } from './pdfText'

// Builds a 3-page PDF: pages 1 and 3 have text, page 2 is blank (like a scan).
function makePdf(): Uint8Array {
  const py = `
from reportlab.pdfgen import canvas
import sys
c = canvas.Canvas(sys.argv[1])
c.drawString(72, 700, "Newton's second law says force equals mass times acceleration.")
c.showPage()
c.showPage()
c.drawString(72, 700, "The French Revolution began in 1789 with the storming of the Bastille.")
c.save()`
  const path = `${process.env.TMPDIR ?? '/tmp'}/pdftext-test.pdf`
  execFileSync('python3', ['-I', '-c', py, path])
  return new Uint8Array(readFileSync(path))
}

describe('readPdfText', async () => {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
  const text = await readPdfText(pdfjs, makePdf())

  test('reads text page by page', () => {
    assert.equal(text.pages, 3)
    assert.match(text.pageTexts[0], /Newton's second law/)
    assert.match(text.pageTexts[2], /French Revolution/)
  })

  test('flags blank pages as needing OCR', () => {
    assert.deepEqual(scannedPages(text), [2])
  })
})
