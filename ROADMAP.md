# ScribeLink Roadmap

Each phase ends with something you can run and demo. Later phases build on earlier ones.

## Phase 1: Foundation and marketing site (done)
- Vite + React + TypeScript project, clean responsive UI with light and dark themes
- Pricing engine (`src/lib/pricing.ts`) implementing the spec: ₹30/page, add-ons, rigid packaging, turnaround formula
- Landing page: hero, how it works, live price calculator, ground rules

## Phase 2: Customer order flow (front end, mock data) (done)
- Routing (React Router) and a shared order state
- Upload step: PDF/image upload, client-side word count, cover/credential page warning
- Add-on and pen/ink configuration form
- Scribe picker with handwriting sample cards
- Checkout screen (mock UPI) and order summary

## Phase 3: Order tracking and scribe app (front end, mock data) (done)
- Customer order tracker following the state machine: Paid, Accepted, Writing, Dispatched, Delivered
- Scribe dashboard: nearby orders, 30-minute intake inspection timer, hourly rush check-ins
- Scribe onboarding: UPI VPA and handwriting sample upload
- Earnings and payout view

## Phase 4: Backend and database
- Node.js API (Express or Fastify) with TypeScript
- PostgreSQL schema from the spec, with migrations
- Phone OTP login, roles (customer, scribe, admin)
- Move pricing and word-count rules to a shared package used by both sides

## Phase 5: Order state machine and money
- Enforced status transitions and deadline calculation
- Escrow ledger and the 24-hour payout clock (scheduled job)
- Payment gateway integration (UPI) in test mode
- Rush protocol: missed check-in reassigns the order and issues a strike

## Phase 6: Logistics, disputes and admin
- Courier integration (Porter / Borzo) with gate-drop photo and delivery OTP
- Unboxing-video dispute flow
- Admin panel: verify handwriting cards, review disputes, manage strikes
- WhatsApp / SMS notifications

## Phase 7: Quality, security and launch
- Automated tests (pricing, state machine, payouts), CI on GitHub Actions
- Rate limiting, input validation, file-upload scanning
- Deploy (front end on Vercel/Netlify, API and DB on a managed host)
- Pilot with one campus

## Open questions to settle early
- Real printing cost per sheet for the custom template add-on (assumed ₹2 in Phase 1)
- How cover-page detection will work (OCR heuristics vs manual review)
- Legal review of the service against each target university's academic integrity rules
