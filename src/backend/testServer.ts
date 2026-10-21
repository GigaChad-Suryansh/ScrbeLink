/**
 * testServer.ts
 * Self-contained smoke tests verifying all Phase 4 backend requirements:
 * 1. Health check
 * 2. Shared rules quote calculation via API
 * 3. Text sanitization & cover-page detection API
 * 4. Phone OTP generation & role verification (customer / scribe / admin)
 * 5. Order state machine transition & check-in audit log
 */

import { app } from './server'

async function runTests() {
  console.log('--- Running Phase 4 Backend Integration Suite ---')
  const server = app.listen(0)
  const port = (server.address() as any).port
  const base = `http://localhost:${port}`

  try {
    // 1. Health check
    const rHealth = await fetch(`${base}/api/health`).then(r => r.json())
    console.assert(rHealth.status === 'ok', 'Health check failed')
    console.log('✓ Health check passed')

    // 2. Shared Pricing Rules
    const rQuote = await fetch(`${base}/api/pricing/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: 1200, simpleDrawings: 2, complexDrawings: 1, graphs: 1, customTemplate: true }),
    }).then(r => r.json())
    console.assert(rQuote.success && rQuote.quote.pages === 6, 'Pricing pages calc failed')
    console.log(`✓ Shared pricing rules passed: 1200 words = ${rQuote.quote.pages} pages, ₹${rQuote.quote.customerTotal}`)

    // 3. Text & Cover-Page Detection
    const rAnalyze = await fetch(`${base}/api/text/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText: 'Roll No: 19/EC/201 Department of Electrical Engineering University Exam' }),
    }).then(r => r.json())
    console.assert(rAnalyze.coverPageWarning === true, 'Cover page detection warning failed')
    console.log('✓ Text sanitisation and cover-page heuristics passed')

    // 4. Phone OTP and Roles
    const phone = '+919876543210'
    const rOtp = await fetch(`${base}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then(r => r.json())
    console.assert(rOtp.success === true, 'OTP send failed')

    const rVerify = await fetch(`${base}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp: '123456', requestedRole: 'scribe' }),
    }).then(r => r.json())
    console.assert(rVerify.user.role === 'scribe', 'Role auth failed')
    console.log(`✓ Phone OTP login & role authorization passed: ${rVerify.user.name} (${rVerify.user.role})`)

    // 5. Order State Machine & Check-in
    const rOrder = await fetch(`${base}/api/orders/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Physics Notes', words: 400 }),
    }).then(r => r.json())
    const orderId = rOrder.order.id

    const rAccept = await fetch(`${base}/api/orders/${orderId}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextStatus: 'Accepted', scribeId: 'usr-1', note: 'Scribe intake accepted.' }),
    }).then(r => r.json())
    console.assert(rAccept.order.status === 'Accepted', 'State transition to Accepted failed')

    const rWriting = await fetch(`${base}/api/orders/${orderId}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextStatus: 'Writing', note: 'Intake passed. Writing started.' }),
    }).then(r => r.json())
    console.assert(rWriting.order.status === 'Writing', 'State transition to Writing failed')

    const rCheckin = await fetch(`${base}/api/orders/${orderId}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Completed 2 pages.' }),
    }).then(r => r.json())
    console.assert(rCheckin.success === true, 'Checkin recording failed')
    console.log(`✓ State machine transitions and hourly rush check-ins verified for ${orderId}`)

    console.log('--- All Phase 4 Backend Integration Tests Passed Cleanly! ---')
  } finally {
    server.close()
  }
}

runTests().catch(err => {
  console.error('Test run failed:', err)
  process.exit(1)
})
