# ScribeLink

A peer-to-peer marketplace where students get their finalized text and diagrams transcribed by hand by verified peer scribes, and delivered by local courier.

Status: the web app and the API are connected. Sign-in, orders, payments (test gateway), scribe sign-up and approval, delivery codes, disputes, evidence videos and payouts all run through the API. See [ROADMAP.md](./ROADMAP.md) for the phases and what is still open.

## Run it

```bash
npm install
npm run dev       # API on :4000 and web app on :5173 together
npm run check     # lint and tests
npm run build     # type-check and build the web app
```

`npm run dev` loads `dev.env`. Sign-in is by phone number and a 6-digit code; in demo mode the code is filled in for you, so no SMS is needed.

Try the whole flow in one browser (each role keeps its own sign-in):

1. **Scribe** (`/scribe/onboarding`): sign in with any Indian mobile number, fill in the profile, upload a handwriting photo and save.
2. **Admin** (`/admin`): sign in with `9999900000`, open the first tab and approve the card.
3. **Customer** (`/order/upload`): upload a text file, choose add-ons and the scribe, then pay with the test UPI gateway.
4. **Scribe** (`/scribe/dashboard`): accept the order, start writing, send a check-in, then dispatch.
5. **Customer** (`/track`): the delivery code appears. The scribe types it in to complete delivery.
6. **Admin**: use "Fast-forward 25 hours" to release escrow, then the scribe can withdraw. Or file a dispute from the tracker first.

Data lives in the API process memory and uploads in a temp folder, so restarting the API clears them. See [DEPLOYMENT.md](./DEPLOYMENT.md) for what a real launch still needs (database, SMS, payments, courier).

## Structure

```
src/
  backend/        Express API, state machine side effects, escrow scheduler, logistics (in-memory)
  shared/         Rules used by both sides: pricing, state machine, upload checks
  lib/api.ts      API client and per-role sign-in sessions
  lib/portal.tsx  Loads orders, profile and wallet from the API and exposes actions
  pages/          Wizard steps, tracker, scribe portal, admin, disputes
  components/     Calculator, sections, sign-in card, layouts
```

## Product rules (summary)

- ₹30 per billable page (200 words, rounded up); the scribe is paid ₹20
- Add-ons for drawings, graphs, college template printing, and rigid packaging on 20+ page orders
- Customers supply all content; scribes never write cover pages or credentials
- No direct contact between customer and scribe; payments held in escrow

## Data storage

Orders, scribes, escrow and payouts live in PostgreSQL. Set `DATABASE_URL` in production. In development the API uses an embedded Postgres (PGlite) that saves to `.data/pglite`, so data survives restarts. Delete that folder to start fresh. Migrations run automatically on start.
