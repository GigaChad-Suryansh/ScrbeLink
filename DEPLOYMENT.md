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
