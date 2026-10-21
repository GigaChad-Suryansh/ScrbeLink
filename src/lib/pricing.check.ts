import { quote, billablePages, turnaroundHours } from './pricing'

const eq = (name: string, a: unknown, b: unknown) => {
  if (a !== b) throw new Error(`${name}: expected ${b}, got ${a}`)
  console.log('ok  ', name)
}

eq('pages round up', billablePages(201), 2)
eq('zero words', billablePages(0), 0)
eq('15 pages = 18h', turnaroundHours(15), 18)
const q1 = quote({ words: 1000, simpleDrawings: 0, complexDrawings: 0, graphs: 0, customTemplate: false })
eq('5 pages price', q1.customerTotal, 150)
eq('5 pages scribe', q1.scribeTotal, 100)
const q2 = quote({ words: 4000, simpleDrawings: 1, complexDrawings: 1, graphs: 1, customTemplate: false })
eq('20 pages + addons customer', q2.customerTotal, 600 + 4 + 8 + 10 + 10)
eq('20 pages + addons scribe', q2.scribeTotal, 400 + 2.5 + 5.5 + 7 + 7)
const q3 = quote({ words: 400, simpleDrawings: 0, complexDrawings: 0, graphs: 0, customTemplate: true })
eq('template customer', q3.customerTotal, 60 + 8)
eq('template scribe', q3.scribeTotal, 40 + 4)
