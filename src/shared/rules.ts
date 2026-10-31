/**
 * shared/rules.ts
 * Unified core business rules for pricing, page calculation, word count,
 * turnaround estimation, and cover-page heuristics.
 * Shared between backend API server and frontend React client.
 */

export const RATES = {
  perPage: { customer: 30, scribe: 20 },
  simpleDrawing: { customer: 4, scribe: 2.5 },
  complexDrawing: { customer: 8, scribe: 5.5 },
  graph: { customer: 10, scribe: 7 },
  rigidPackaging: { customer: 10, scribe: 7, minPages: 20 },
  templatePrintCostPerSheet: 2,
  templateMarkupPerSheet: 2,
  wordsPerPage: 200,
  minOrderPages: 10,
  pagesPerBlock: 15,
  hoursPerBlock: 18,
} as const

export interface OrderInput {
  words: number
  simpleDrawings: number
  complexDrawings: number
  graphs: number
  customTemplate: boolean
}

export interface LineItem {
  label: string
  detail: string
  customer: number
  scribe: number
}

export interface Quote {
  pages: number
  items: LineItem[]
  customerTotal: number
  scribeTotal: number
  platformTotal: number
  turnaroundHours: number
}

const money = (n: number) => Math.round(n * 100) / 100

export function billablePages(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 0
  return Math.ceil(words / RATES.wordsPerPage)
}

/** Every order must be at least this many billable pages. */
export function meetsMinimum(words: number): boolean {
  return billablePages(words) >= RATES.minOrderPages
}

export const MIN_ORDER_MESSAGE = `Orders start at ${RATES.minOrderPages} pages (more than ${(RATES.minOrderPages - 1) * RATES.wordsPerPage} words).`

export function turnaroundHours(pages: number): number {
  return money((pages / RATES.pagesPerBlock) * RATES.hoursPerBlock)
}

export function formatDuration(hours: number): string {
  if (hours <= 0) return '—'
  if (hours < 1) return `${Math.round(hours * 60)} min`
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

export const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function calculateQuote(input: OrderInput): Quote {
  const pages = billablePages(input.words)
  const items: LineItem[] = []

  if (pages > 0) {
    items.push({
      label: 'Transcription',
      detail: `${pages} page${pages > 1 ? 's' : ''} × ${inr(RATES.perPage.customer)}`,
      customer: pages * RATES.perPage.customer,
      scribe: pages * RATES.perPage.scribe,
    })

    const addOn = (label: string, count: number, r: { customer: number; scribe: number }) => {
      if (count > 0)
        items.push({
          label,
          detail: `${count} × ${inr(r.customer)}`,
          customer: count * r.customer,
          scribe: count * r.scribe,
        })
    }
    addOn('Simple drawings', input.simpleDrawings, RATES.simpleDrawing)
    addOn('Complex drawings', input.complexDrawings, RATES.complexDrawing)
    addOn('Calibrated graphs', input.graphs, RATES.graph)

    if (input.customTemplate) {
      const perSheet = RATES.templatePrintCostPerSheet
      items.push({
        label: 'College template printing',
        detail: `${pages} sheet${pages > 1 ? 's' : ''} × ${inr(perSheet + RATES.templateMarkupPerSheet)}`,
        customer: pages * (perSheet + RATES.templateMarkupPerSheet),
        scribe: pages * perSheet,
      })
    }

    if (pages >= RATES.rigidPackaging.minPages) {
      items.push({
        label: 'Rigid packaging',
        detail: `Orders of ${RATES.rigidPackaging.minPages}+ pages`,
        customer: RATES.rigidPackaging.customer,
        scribe: RATES.rigidPackaging.scribe,
      })
    }
  }

  const customerTotal = money(items.reduce((s, i) => s + i.customer, 0))
  const scribeTotal = money(items.reduce((s, i) => s + i.scribe, 0))
  return {
    pages,
    items,
    customerTotal,
    scribeTotal,
    platformTotal: money(customerTotal - scribeTotal),
    turnaroundHours: turnaroundHours(pages),
  }
}

/** Sanitize and count words */
export function sanitizeText(raw: string): string {
  return raw
    .replace(/\uFEFF/g, '')
    .replace(/[\x00-\x08\x0B\x0E-\x1F\x7F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Cover page detection */
const COVER_KEYWORDS = [
  'roll no', 'roll number', 'enrollment', 'enrolment', 'registration no',
  'university', 'college', 'institute', 'department', 'faculty',
  'subject', 'course', 'submitted by', 'submitted to', 'prepared by',
  'academic year', 'semester', 'session', 'exam', 'examination',
  'certificate', 'acknowledgement', 'declaration', 'index', 'contents',
  'title page', 'cover page',
]

export function checkCoverPage(text: string): { score: number; warning: boolean; matches: string[] } {
  const lower = text.toLowerCase()
  const sample = lower.split(/\s+/).slice(0, 300).join(' ')
  const matches: string[] = []
  for (const kw of COVER_KEYWORDS) {
    if (sample.includes(kw)) matches.push(kw)
  }
  const score = Math.min(matches.length * 0.15, 1)
  return { score, warning: score >= 0.3 || matches.length >= 2, matches }
}
