/**
 * scripts/load-test.mjs
 * Phase 19: Lightweight load test for /api/health and /api/pricing/quote (plus optional order/payment path).
 * Usage: BASE_URL=http://127.0.0.1:4000 CONCURRENCY=20 REQUESTS=200 node scripts/load-test.mjs
 */

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '')
const CONCURRENCY = Number(process.env.CONCURRENCY || 15)
const TOTAL = Number(process.env.REQUESTS || 150)

const latencies = []
let ok = 0
let fail = 0
let cursor = 0

async function hit(i) {
  const start = performance.now()
  try {
    const isQuote = i % 2 === 0
    const res = await fetch(isQuote ? `${BASE}/api/pricing/quote` : `${BASE}/api/health`, {
      method: isQuote ? 'POST' : 'GET',
      headers: isQuote ? { 'Content-Type': 'application/json' } : {},
      body: isQuote ? JSON.stringify({ words: 2400, simpleDrawings: 1 }) : undefined,
    })
    if (res.ok) ok++
    else fail++
  } catch {
    fail++
  } finally {
    latencies.push(performance.now() - start)
  }
}

async function worker() {
  while (true) {
    const i = cursor++
    if (i >= TOTAL) return
    await hit(i)
  }
}

const t0 = performance.now()
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
const elapsedMs = performance.now() - t0
latencies.sort((a, b) => a - b)
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0

console.log(JSON.stringify({
  base: BASE,
  total: TOTAL,
  concurrency: CONCURRENCY,
  ok,
  fail,
  rps: Math.round((TOTAL / (elapsedMs / 1000)) * 10) / 10,
  p50Ms: Math.round(pct(50)),
  p95Ms: Math.round(pct(95)),
  p99Ms: Math.round(pct(99)),
}, null, 2))

if (fail > 0) process.exit(1)
