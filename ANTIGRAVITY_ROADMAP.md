# ScribeLink: Roadmap to a complete product

Written as a work plan for Antigravity (or any coding agent). Work top to bottom. Each phase lists tasks and an **Done when** check, so you know when to stop.

Read first: `README.md`, `ROADMAP.md` (phases 1-8, already built), `DEPLOYMENT.md`, `src/backend/server.ts`, `src/backend/migrations.ts`.
Rules: keep `npm run check` and `npm run build` green; add a test for every backend change; no emojis in the UI (use `src/components/Icons.tsx`); the browser bundle must not import Node-only modules.

---

## 1. The full journey (the "Flipkart flow", with Porter)

Flipkart ships a product from a warehouse. ScribeLink ships a **handwritten copy of the customer's notes** from a scribe to a campus gate. Same steps, different parts:

| # | Stage | Flipkart / Amazon | ScribeLink | Built? |
|---|-------|-------------------|------------|--------|
| 1 | Sign up / login | Phone or email + OTP | Phone + OTP, per role | Demo code only |
| 2 | Browse and configure | Pick product, size | Upload notes, pick add-ons and pen, pick scribe | Yes (text extraction is a stub) |
| 3 | Delivery address | Saved addresses | Saved campus gates (college, gate, landmark, contact) | No |
| 4 | Pay | UPI, card, COD | UPI (Razorpay) | Test mode only |
| 5 | Order confirmed | SMS, email, invoice | SMS/WhatsApp + GST invoice | Log only |
| 6 | Seller accepts and packs | Seller packs | Scribe accepts, inspects, writes, packs, uploads proof photo | Mostly |
| 7 | Courier pickup | Pickup agent scans parcel | **Porter pickup at scribe's address with pickup OTP** | Simulated |
| 8 | In transit | Live tracking | **Live Porter tracking and rider call button** | No |
| 9 | Delivered | OTP at door | Delivery OTP at the gate (customer reads it out) | Yes |
| 10 | After delivery | Rate, return, refund | 24h dispute window, rating, refund | Dispute only, no rating or refund |
| 11 | Money | Seller settlement | Escrow release, payout to UPI, TDS and records | Ledger only, no real transfer |
| 12 | Support | Chat, tickets | Help centre and ticket per order | No |

---

## 2. What you are probably missing

Things a real launch needs that are not on any list yet:

- **Real notes extraction.** `StepUpload` reads raw PDF bytes, so page and word counts are wrong for real files. Use pdf.js for text PDFs and OCR for scans.
- **Real SMS for sign-in codes** and a real payment provider. Both are demo today.
- **Saved gate/address book** and a **pickup address** for scribes (Porter needs both ends).
- **Refunds and cancellation rules.** Money back when no scribe accepts, when a scribe is suspended, when a dispute is upheld.
- **Ratings and reviews** for scribes (and the right to hide a scribe who keeps getting low ratings).
- **Invoices.** GST invoice for the customer; payout statement for the scribe.
- **Scribe identity checks** (college ID, PAN for payouts). Needed before real money moves.
- **Tax and payout rules.** TDS and who is the seller of record. Ask a CA before launch.
- **Legal pages.** Terms, privacy policy (India's DPDP Act), refund policy, academic integrity policy. A university can ban this service; the policy must say what you do about that.
- **Delete uploaded notes** after delivery (data retention) so customer files do not sit forever.
- **Support.** A help page and a ticket per order.
- **Account page** for each role: profile, order history, re-order, sign-out everywhere.
- **Monitoring and backups.** Error tracking, structured logs, daily database backup, a restore test.
- **Fraud and abuse limits.** Duplicate accounts, fake disputes, scribes taking orders and vanishing.
- **Phone-first UI.** Most students will use a phone. Test every screen at 360px wide, consider a PWA install.
- **Hindi (and later other languages).**

---

## 3. Phases

### Phase 9: Real sign-in and accounts
- Replace the demo code with a real SMS provider (MSG91 or Twilio). Keep the demo code only when `NODE_ENV` is not production.
- One sign-in page with a role choice, clear errors, resend after 30 seconds, lockout message.
- Refresh tokens, "sign out of all devices", session expiry that returns the user to where they were.
- Account page per role: name, phone, email (optional), order history.
- **Done when:** a new person can sign up on a phone with a real SMS code and see their empty account page. Tests cover lockout and expiry.

### Phase 10: Real notes upload
- Extract text with pdf.js for text PDFs; OCR (Tesseract.js or a server call) for images and scanned PDFs.
- Page and word count from real content. Show a preview of detected pages with the cover-page warning on the exact page.
- Server-side re-check of the count before charging (never trust the browser).
- Store the file privately; delete it 7 days after the order closes.
- **Done when:** uploading a 10-page PDF and a phone photo of notes both give a sensible price.

### Phase 11: Gate and address book
- Customer: saved campus gates (college, gate name, landmark, contact name and number, map pin).
- Scribe: pickup address and the area they cover.
- Price and time estimate depend on distance between the two (Porter fare plus margin). Update the pricing rules and the calculator to match.
- **Done when:** checkout asks "deliver to which gate?" and shows an estimated delivery time.

### Phase 12: Real payments and refunds
- Razorpay (UPI and cards) with webhook verification, idempotent orders, and failed-payment retry.
- Refund flow with reasons: no scribe in time, scribe suspended, dispute upheld, customer cancelled before accept.
- Cancellation rules shown before paying.
- GST invoice PDF per order.
- **Done when:** a test-mode payment, a partial refund and a full refund all show correctly in the customer view, scribe wallet and admin ledger.

### Phase 13: Porter delivery (the "Amazon logistics" part)
- Integrate Porter's business API (or Borzo as a fallback). **Confirm with Porter that API access is available for your account type before building**; if not, build a manual "book Porter" admin tool first and automate later.
- Booking: when the scribe taps "Finished", create a pickup at the scribe's address and a drop at the customer's gate.
- **Pickup OTP** read by the scribe to the rider, so the parcel handed over is the right one.
- Webhooks for rider assigned, picked up, near drop, delivered, cancelled. Map each to an order status and a notification.
- Live tracking on the customer's order page (rider name, vehicle, phone via Porter's masked call, ETA, map).
- Failure handling: no rider found (retry, then notify admin), rider cancels (rebook), customer unreachable (wait rules, return-to-scribe).
- Parcel packaging checklist for the scribe and a proof photo before dispatch; unboxing video guidance for the customer.
- **Done when:** a test booking moves the order from Dispatched to Delivered by webhook only, with the OTP check, and a failed pickup rebooks.

### Phase 14: Notifications
- WhatsApp (or SMS fallback) for: order paid, scribe accepted, writing started, check-in missed, dispatched with tracking link, delivered, dispute opened/resolved, payout sent.
- Email for invoices.
- In-app notification list with unread count.
- User settings: which channels to use.
- **Done when:** each event above sends exactly one message and failures retry without duplicates.

### Phase 15: Ratings, support and trust
- Customer rates the scribe after the dispute window (handwriting, neatness, timeliness) with an optional comment.
- Scribe profile shows rating and completed orders; low-rated scribes are flagged to admin.
- Help centre page, FAQ, and a support ticket linked to an order. Admin inbox to answer tickets.
- Report a scribe or a customer.
- **Done when:** a delivered order can be rated once, shown on the scribe card, and a ticket can be opened and closed.

### Phase 16: Scribe onboarding and payouts for real
- Scribe verification: college ID photo, selfie, PAN (stored encrypted), admin review.
- Real payouts through RazorpayX (or the payment provider's payout API) with status tracking and failure retry.
- Monthly earnings statement and TDS record (after CA advice).
- Capacity: scribe sets "I can take N pages today" and a vacation switch.
- **Done when:** a verified scribe can withdraw to a real test UPI ID and see the statement.

### Phase 17: Admin and operations
- Dashboard: orders today, late orders, open disputes, scribes waiting for approval, money in escrow.
- Search by order, phone or scribe; full order timeline and audit log.
- Manual tools: reassign an order, refund, suspend or reinstate a scribe, resend a message.
- Export CSV for accounts.
- **Done when:** an admin can resolve a stuck order without touching the database.

### Phase 18: Legal, safety and policy
- Pages: Terms, Privacy (DPDP Act), Refunds, Academic integrity, Contact. Acceptance recorded at sign-up.
- Consent for storing notes and videos; a way to download or delete your data.
- Blocklist for cover pages and exam material marked as confidential; report flow for misuse.
- Get a lawyer to review before taking real money.
- **Done when:** every page is linked in the footer and sign-up records the accepted version.

### Phase 19: Reliability and launch
- Deploy: front end on Vercel; API plus Postgres on a managed host (Render, Railway or Fly). Update `DEPLOYMENT.md` and the Dockerfile for `DATABASE_URL`.
- Move OTP codes and rate limits to Redis so more than one API server works.
- Move uploads to object storage (S3 or R2) with private signed links.
- Error tracking (Sentry), log shipping, uptime check, daily database backups with a tested restore.
- Load test the order and payment paths.
- Playwright end-to-end tests in CI for the whole journey.
- **Done when:** the journey in section 1 runs on a public URL with real SMS, payment and Porter in test mode.

### Phase 20: Pilot and growth
- One-campus pilot with a small group of scribes and customers; track time to accept, time to deliver, dispute rate, rating.
- Fix the top three problems before opening a second campus.
- Then: referral codes, repeat-order shortcut, student ID discount, Hindi, installable app (PWA).

---

## 4. Order of work if time is short

Minimum to take the first real order: **9, 10, 11, 12, 13, 18, 19**. Everything else can follow the pilot.

## 5. Decisions made (by the owner)

- **Scribes are paid by ScribeLink**, per page (₹20 of the ₹30). ScribeLink is the seller of record, so GST and TDS apply to ScribeLink. Get a CA to confirm before launch (Phases 12 and 16).
- **Porter's fare is built into the price.** No separate delivery fee. `pricing.ts` must cover the Porter cost, so Phase 11 should compute the margin per distance band and the owner should check that ₹30/page still leaves room; keep a flat minimum order charge if short orders lose money.
- **If a college bans the service, students will still use it.** Plan: deliver to a gate or nearby public point, not inside campus; keep the policy page honest (Phase 18); do not tell students how to hide use from their college.
- **Minimum order is 10 pages** (more than 1,800 words, at least ₹300). Built and enforced in the API, upload step and calculator (`RATES.minOrderPages`). This also covers the short-order Porter cost worry.
- **Printing add-on stays at ₹2 per sheet** for now. Revisit after the pilot with real costs.

## 6. Still open

- Exact Porter cost per distance band (needs a real quote from Porter).
