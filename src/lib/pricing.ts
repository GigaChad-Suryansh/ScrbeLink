// Pricing rules from the ScribeLink operating standard (sections 2 and 4.1).

export const RATES = {
  perPage: { customer: 30, scribe: 20 },
  simpleDrawing: { customer: 4, scribe: 2.5 },
  complexDrawing: { customer: 8, scribe: 5.5 },
  graph: { customer: 10, scribe: 7 },
  rigidPackaging: { customer: 10, scribe: 7, minPages: 20 },
  // Custom template: customer pays printing cost + ₹2/sheet, scribe is paid at cost.
  // The spec does not fix the printing cost, so this is an assumed default.
  templatePrintCostPerSheet: 2,
  templateMarkupPerSheet: 2,
  wordsPerPage: 200,
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

export function quote(input: OrderInput): Quote {
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
