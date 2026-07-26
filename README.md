# Threadline

A modern clothing e-commerce store — built in public, one stage at a time.

> **Working name.** The brand name is not final; the repo will be renamed once it is.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) · React 19 · TypeScript strict |
| Backend + Admin | Payload CMS 3, embedded in the same app |
| Database | PostgreSQL |
| Styling | Tailwind 4 · shadcn/ui |
| Payments | Razorpay |
| Shipping | Shiprocket |
| Email | Resend + React Email |
| WhatsApp | Meta WhatsApp Cloud API |
| AI assistant | Anthropic Claude API |
| Tests | Vitest · Playwright |
| Hosting | AWS |

## What it does

A full clothing storefront with a size × colour variant model at its core — per-variant SKUs and
stock, an append-only stock ledger, size charts, guest checkout with GST and coupons, order
tracking, returns and size exchanges, wishlist with back-in-stock alerts, reviews with fit feedback,
loyalty points, email and WhatsApp notifications, a customer support ticket system with an AI
assistant, and role-based staff access.

## Project structure

```
src/
├─ app/            (storefront) · (payload) · api/
├─ collections/    Payload collections, one file each
├─ access/         role-based access functions
├─ components/     ui · product · cart · checkout · account · layout
├─ lib/            pricing · inventory · orders · payments · shipping · notify · ai · scheduler · seo
├─ types/          shared unions and DTOs
└─ styles/         design tokens
tests/             unit · e2e
docs/              SCHEMA · DESIGN · FEATURES · ARCHITECTURE
```

Business logic lives in `src/lib/` — pure, framework-agnostic and unit-tested. Components render;
they don't decide.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in the values, including SEED_PASSWORD
npm run seed                   # demo catalog + one staff account per role
npm run dev
```

Storefront at `http://localhost:3000`, admin at `http://localhost:3000/admin`.

The seed creates staff accounts at `<role>@threadline.example` — `super_admin@threadline.example`
and so on — all using `SEED_PASSWORD`, plus a demo customer at `demo@threadline.example`.
It is idempotent, so re-running it after a schema change is safe, and it refuses to run with
`NODE_ENV=production`.

Schema is pushed automatically in development. Production runs the generated migrations in
`src/migrations/` with `npm run payload migrate`.

## Scripts

```bash
npm run dev         # dev server
npm run build       # production build
npm run seed        # idempotent demo catalog
npm test            # unit + integration tests
npm run test:e2e    # Playwright
npm run check       # typecheck + lint + test
```

## Roadmap

Development runs as a staged journey — see [`CLAUDE.md`](./CLAUDE.md).

- [x] J0 Foundation
- [x] J1 Data model
- [ ] J2 Admin usability
- [ ] J3 Storefront: browse
- [ ] J4 Cart & checkout
- [ ] J5 Orders, fulfilment & scheduler
- [ ] J6 Notifications: email & WhatsApp
- [ ] J7 Customer support & AI assistant
- [ ] J8 Account, returns & loyalty
- [ ] J9 SEO & performance
- [ ] J10 Launch

## Documentation

- [`docs/SCHEMA.md`](./docs/SCHEMA.md) — data model
- [`docs/DESIGN.md`](./docs/DESIGN.md) — design system and UI rules
- [`docs/FEATURES.md`](./docs/FEATURES.md) — feature inbox
- [`CLAUDE.md`](./CLAUDE.md) — engineering standards and the build journey
