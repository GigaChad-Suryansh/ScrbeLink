/**
 * extractText.ts
 * Reads the words out of an uploaded file in the browser.
 *  - .txt: read as text
 *  - PDF: pdf.js reads the text layer; pages that are scans are read with OCR
 *  - JPG/PNG/WebP: OCR
 * The heavy libraries load only when needed, so they do not slow down the rest of the site.
 */

import { readPdfText, scannedPages, type PdfJs } from './pdfText'

export interface Extracted {
  text: string
  /** Number of PDF pages or 1 for a photo; null for a text file. */
  pages: number | null
  /** True when any part of the text came from OCR, so the count is an estimate. */
  usedOcr: boolean
}

const MAX_OCR_PAGES = 30
export type Progress = (message: string) => void

async function ocr(image: Blob | HTMLCanvasElement, onProgress?: Progress): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(`Reading handwriting or scan... ${Math.round(m.progress * 100)}%`)
    },
  })
  try {
    return (await worker.recognize(image)).data.text
  } finally {
    await worker.terminate()
  }
}

async function loadPdfJs(): Promise<PdfJs & { GlobalWorkerOptions: { workerSrc: string } }> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  return pdfjs as never
}

async function renderPage(bytes: Uint8Array, pageNumber: number): Promise<HTMLCanvasElement> {
  const pdfjs = (await loadPdfJs()) as unknown as {
    getDocument(s: { data: Uint8Array }): { promise: Promise<{ getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: unknown): { promise: Promise<void> } }> }> }
  }
  const page = await (await pdfjs.getDocument({ data: bytes.slice() }).promise).getPage(pageNumber)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, viewport }).promise
  return canvas
}

export async function extractText(file: File, onProgress?: Progress): Promise<Extracted> {
  if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) {
    return { text: await file.text(), pages: null, usedOcr: false }
  }

  if (file.type.startsWith('image/')) {
    onProgress?.('Reading the photo...')
    return { text: await ocr(file, onProgress), pages: 1, usedOcr: true }
  }

  onProgress?.('Reading the PDF...')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await readPdfText(await loadPdfJs(), bytes.slice())
  const parts = [...pdf.pageTexts]
  const scans = scannedPages(pdf)
  for (const n of scans.slice(0, MAX_OCR_PAGES)) {
    onProgress?.(`Reading scanned page ${n} of ${pdf.pages}...`)
    parts[n - 1] = await ocr(await renderPage(bytes, n), onProgress)
  }
  return { text: parts.join('\n\n'), pages: pdf.pages, usedOcr: scans.length > 0 }
}
