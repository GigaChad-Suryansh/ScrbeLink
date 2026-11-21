/**
 * Pulls the text out of a PDF page by page. The pdf.js module is passed in so the browser
 * and the tests can each load their own build.
 */

interface PdfPage { getTextContent(): Promise<{ items: Array<{ str?: string }> }> }
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage> }
export interface PdfJs { getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDoc> } }

export interface PdfText {
  pages: number
  /** Text of each page, in order. Scanned pages come back (almost) empty. */
  pageTexts: string[]
}

export async function readPdfText(pdfjs: PdfJs, bytes: Uint8Array): Promise<PdfText> {
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const pageTexts: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    pageTexts.push(content.items.map((i) => i.str ?? '').join(' '))
  }
  return { pages: doc.numPages, pageTexts }
}

/** A page with fewer characters than this is treated as a scan that needs OCR. */
export const MIN_TEXT_CHARS = 25

export const scannedPages = (t: PdfText): number[] =>
  t.pageTexts.flatMap((s, i) => (s.replace(/\s/g, '').length < MIN_TEXT_CHARS ? [i + 1] : []))
