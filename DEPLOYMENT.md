# Deployment notes

The web app (Vite build) and the API (Express, run with `tsx`) deploy separately.

## What works today
- Sign-in by phone and 6-digit code, with per-role sessions (customer, scribe, admin)
- Orders, test UPI payments, delivery codes, disputes, payouts and withdrawals through the API
- Uploads checked by real file content (type, size, PDF scripts)

## What a real launch still needs
1. **Database.** Orders, scribes, disputes, escrow and the wallet ledger live in API memory. A restart clears them. Move them to PostgreSQL.
2. **File storage.** Sample photos and evidence videos are written to `UPLOAD_DIR` (a temp folder by default). Use a persistent disk or object storage.
3. **SMS.** Codes are returned in the response in demo mode. In production, `/api/auth/otp/send` answers 503 until a provider is added.
4. **Payments.** Only the UPI test gateway exists. In production it answers 503 unless `ALLOW_TEST_PAYMENTS=true`.
5. **Courier.** Dispatch and delivery are simulated. Withdrawals are recorded, not sent.
6. **Docker image** has not been built or run yet.

## Wiring the two halves
- Same origin is simplest: put the API behind the same host and forward `/api` to it (Vite does this in development and preview; on Vercel add a rewrite from `/api/:path*` to your API host).
- Otherwise build the web app with `VITE_API_URL=https://your-api-host` and list the web origin in the API's `CORS_ORIGINS`.
- Set `SESSION_SECRET` (32+ characters), `ADMIN_PHONES`, `CRON_SECRET` and `TRUST_PROXY` as in `.env.example`.
- The API also runs the escrow and rush-protocol jobs every minute; platform cron can still call `/api/cron/trigger-jobs`.

## Payments with Razorpay

1. In the Razorpay dashboard (test mode first), copy the key id and key secret.
2. Add a webhook pointing to `https://<your-api>/api/payment/razorpay/webhook` with the events `payment.captured` and `refund.processed`. Copy the webhook secret.
3. On the API host set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
4. Run `/api/cron/trigger-jobs` every hour. It cancels orders nobody accepted within 6 hours, sends refunds to Razorpay, and deletes expired files.
5. Place one test payment and one cancellation, and check the refund shows as sent after Razorpay's webhook arrives.

The front end loads Razorpay's checkout from `checkout.razorpay.com`. `vercel.json` already allows it. If the API is on a different domain from the site, also add that domain to `connect-src` in `vercel.json`.

## Courier (Porter) in production

Set `COURIER_PROVIDER=manual` and `PUBLIC_APP_URL` to your site address. When a scribe taps "Finished, ask for a pickup", the order appears in Admin, Couriers. Book a Porter by hand, type the rider's name and phone there, and send them the private link (a WhatsApp button is provided). The rider opens the link on their phone, types the pickup code the scribe reads out, then the delivery code the recipient reads out. Delivery is confirmed only by that second code.

## Production reliability (Phase 19)

1. **API + Postgres (Render / Railway / Fly):** Build from `Dockerfile` and set `DATABASE_URL` to your managed PostgreSQL connection string. Migrations run automatically on startup.
2. **Redis:** Set `REDIS_URL` (`redis://...` or `rediss://...`) so OTP codes work across multiple API instances.
3. **Object storage (R2 / S3):** Set `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` for private uploads with SigV4 signed URLs (`src/backend/s3Store.ts`).
4. **Monitoring & error tracking:** Set `SENTRY_DSN` for automatic exception reporting (`src/backend/telemetry.ts`). Point an uptime monitor at `GET /api/health`.
5. **Backups & load testing:**
   - Daily backup & restore test: `DATABASE_URL=... VERIFY_RESTORE_URL=... node scripts/backup-verify.mjs`
   - Load test: `BASE_URL=https://your-api node scripts/load-test.mjs`
   - E2E journey test: `npx playwright test e2e/journey.spec.ts`
