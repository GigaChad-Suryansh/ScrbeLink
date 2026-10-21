# ScribeLink

A peer-to-peer marketplace where students get their finalized text and diagrams transcribed by hand by verified peer scribes, and delivered by local courier.

Status: **Phase 1** (marketing site and live price calculator). See [ROADMAP.md](./ROADMAP.md) for all phases.

## Run it

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check and build for production
npm run check     # run the pricing checks
```

## Structure

```
src/
  lib/pricing.ts          Pricing and turnaround rules from the spec
  lib/pricing.check.ts    Quick assertions for the pricing engine
  components/Calculator   Live quote calculator
  components/Sections     How it works, rules, footer
```

## Product rules (summary)

- ₹30 per billable page (200 words, rounded up); the scribe is paid ₹20
- Add-ons for drawings, graphs, college template printing, and rigid packaging on 20+ page orders
- Customers supply all content; scribes never write cover pages or credentials
- No direct contact between customer and scribe; payments held in escrow
