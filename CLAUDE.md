# Threadline — CLAUDE.md (Master Journey File)

> Loaded automatically on every session start.
> Work the **Journey** below top to bottom. One stage at a time. Mark `[x]` only when the
> stage's tests pass. Update the Session Log at the end of every session.
> Created: 2026-07-26 · Last updated: 2026-07-26

---

## 0. HOW THIS FILE WORKS (read first, every session)

This file is a **loop**, not a document. Each session:

1. Read this file, then read `docs/FEATURES.md` for anything new in its Inbox.
2. Find the first stage that is not `[x]`.
3. If that stage has no task list yet → **expand it first** (write its tasks in), then start.
4. Do the tasks. Write the tests. Run them. Fix until green.
5. Mark `[x]`, commit, push, append one line to the Session Log.
6. When tokens run low → stop cleanly, log exactly where you stopped.

**Progressive expansion.** Only the *active* stage carries detailed tasks. Later stages are
headlines only. Expand a stage when you reach it; collapse it to one line once complete.
This keeps the file small and every session cheap.

**Re-looping.** New features arrive through `docs/FEATURES.md`. Spec them there, then append a new
stage (`J11`, `J12`, …) at the bottom of the journey. The journey is never rewritten, only extended.

**Loop command (user runs this):**

```
/loop Read C:\xampp\htdocs\cloth_website\CLAUDE.md and docs/FEATURES.md, find the first unchecked
stage, expand it if it has no tasks, complete it with tests, mark [x], commit and push, update the
Session Log, continue. Do not ask for confirmation except for destructive DB operations or spend.
```

---

## 1. PROJECT IDENTITY

| Property | Value |
|---|---|
| Project | **Threadline** — clothing e-commerce store *(working name, rename when the brand is set)* |
| Root | `C:\xampp\htdocs\cloth_website` |
| Repo | public, GitHub `ravirajladha` |
| Framework | Next.js 16 (App Router) + React 19 + TypeScript (strict) |
| Backend + Admin | Payload CMS 3 — embedded in the same Next.js app |
| Database | PostgreSQL (local · prod: AWS RDS) |
| Styling | Tailwind 4 + shadcn/ui |
| Media | S3-compatible storage via Payload S3 adapter (never local disk) |
| Payments | Razorpay (Node SDK) |
| Shipping | Shiprocket REST |
| Email | Resend + React Email |
| WhatsApp | Meta WhatsApp Cloud API |
| AI assistant | Anthropic Claude API (`ANTHROPIC_API_KEY`) — support chatbot |
| Tests | Vitest (unit/integration) + Playwright (e2e) |
| Hosting | AWS — EC2 + RDS + S3/CloudFront, or Amplify Hosting |

### Engineering standards this project holds itself to
| Standard | Meaning |
|---|---|
| Logic outside the framework | Business rules live in `src/lib/*`, framework-agnostic and unit-tested — never buried in admin config or components |
| Tested by default | Every `lib/` module ships with unit tests; critical flows have e2e. Untested code is unfinished code |
| Variants are the core | Size × colour is modelled from day one, not retrofitted |
| Notifications are a system | One dispatcher, many channels — not scattered `send()` calls |
| Support is a product surface | Ticketing and an AI assistant, not a mailto link |
| Returns are first-class | Clothing runs 20–40% returns; exchange-for-size is a designed flow |
| One scheduler | A single job registry, not ad-hoc cron entries |
| SEO from the first page | Metadata and structured data built in, never retrofitted |

---

## 2. ABSOLUTE RULES

### Attribution
- **Never add Claude, Anthropic, or any AI tool as an author, co-author or contributor.** No
  `Co-Authored-By` trailers, no "Generated with" footers, no AI mentions in commits, PRs, README,
  code comments or docs. Every commit is authored solely by the repo owner.

### Public repository
- This repo is **public**. Never commit client names, other projects, private business data,
  credentials, invoices, or internal notes about third parties.
- `.env*` is gitignored. `.env.example` documents keys with empty values only.
- Seed data must be fictional.

### Database
- Never `DROP`, `TRUNCATE`, or destructively alter a table without explicit written instruction in the current session.
- Payload owns the schema. Change collections, then generate a migration — never hand-edit tables.
- Migrations run against local Postgres first. Never against RDS from a dev session.
- Before any migration: `npm run payload migrate:status`.

### Code
- **No business logic in components.** Components render. `src/lib/*` decides.
- **One source of truth for money.** All price, tax, discount and total maths lives in `src/lib/pricing/`.
- **Money is integer paise.** Never floats. Format only at the render boundary.
- **Every external API sits behind an adapter** in `src/lib/` with a typed interface, so tests can mock it.
- **No magic strings.** Order statuses, size groups, notification types, roles → union types in `src/types/`.
- **Server Components by default.** `"use client"` only for real interactivity.
- No `any` at module boundaries. `strict: true` stays on.

### Security — OWASP Top 10

Every stage is reviewed against this list before it is marked `[x]`. This is the project's
security baseline, not an audit that happens later.

| # | Risk | How this codebase answers it |
|---|---|---|
| A01 | Broken access control | Every collection declares `access` functions from `src/access/`. Deny by default. A customer may only ever read their own orders, addresses, tickets and returns — enforced server-side, never by hiding UI. Tested per role |
| A02 | Cryptographic failures | HTTPS everywhere. Payload hashes passwords (argon2). No secret in code or client bundle. Only `NEXT_PUBLIC_*` reaches the browser |
| A03 | Injection | Payload/Drizzle parameterises all SQL — no string-built queries. React escapes output by default; `dangerouslySetInnerHTML` requires sanitised input and a comment justifying it. Rich text renders through Lexical, never raw |
| A04 | Insecure design | Server is the authority on price, stock and totals — the client's numbers are never trusted. Stock is reserved before payment. Order status transitions are validated. Uploads restricted by MIME type |
| A05 | Security misconfiguration | Security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors) in `next.config.ts`. `debug` and the GraphQL playground are off in production. No stack traces to clients |
| A06 | Vulnerable components | `npm audit` in the check routine; dependencies pinned; Dependabot on the repo |
| A07 | Authentication failures | Rate-limited login, account lockout, strong password policy, secure httpOnly SameSite cookies, short-lived sessions, no user enumeration in error messages |
| A08 | Data integrity failures | Every webhook verifies its signature before processing (Razorpay, Shiprocket, WhatsApp) and is idempotent by event id. Stock is an append-only ledger |
| A09 | Logging failures | Auth attempts, payment events, refunds, role changes and admin mutations are logged. Logs never contain card data, tokens, passwords or full addresses |
| A10 | SSRF | No user-supplied URL is ever fetched server-side. Outbound calls go only to allow-listed provider hosts through `lib/` adapters |

**Additional standing rules**
- Validate and type every external input at the boundary — webhook bodies, query params, form data.
- Rate-limit every public mutation: login, register, add-to-cart, coupon apply, chat, review submit.
- Cron routes require `CRON_SECRET`; reject anything else with a 404, not a 401.
- The AI assistant may only ever see the signed-in customer's own data, with strict token and spend caps.
- Never log or echo the Neon connection string, API keys or customer PII.

### Process
- No stage is `[x]` until `npm run check` passes.
- Every stage is reviewed against the OWASP table above before being marked done.
- Never mark a partially built task done — split it instead.
- Prefer reversible changes. If it can't be undone easily, ask first.

---

## 3. STRUCTURE (the contract)

```
cloth_website/
├─ src/
│  ├─ app/
│  │  ├─ (storefront)/          # public site — home, category, product, cart, checkout, account
│  │  ├─ (payload)/             # admin routes (generated)
│  │  └─ api/
│  │     ├─ webhooks/           # razorpay · shiprocket · whatsapp
│  │     ├─ chat/               # Claude assistant endpoint
│  │     └─ cron/               # scheduled jobs (secret-protected)
│  ├─ collections/              # Payload collections — ONE FILE PER COLLECTION
│  ├─ access/                   # role-based access functions, shared across collections
│  ├─ components/
│  │  ├─ ui/                    # shadcn primitives — zero business logic, zero data fetching
│  │  ├─ product/               # ProductCard · VariantPicker · SizeChart · Gallery
│  │  ├─ cart/ · checkout/ · account/ · support/
│  │  └─ layout/                # Header · Footer · Nav · Breadcrumbs
│  ├─ lib/
│  │  ├─ pricing/               # price · GST · coupon · loyalty — pure, heavily tested
│  │  ├─ inventory/             # stock reservation, movement ledger
│  │  ├─ orders/                # status machine, transitions
│  │  ├─ payments/razorpay.ts
│  │  ├─ shipping/shiprocket.ts
│  │  ├─ notify/                # email.ts · whatsapp.ts · dispatcher.ts
│  │  ├─ ai/                    # Claude client, prompt builders, catalog context
│  │  ├─ scheduler/             # job registry + handlers
│  │  ├─ seo/                   # metadata builders, JSON-LD
│  │  └─ utils/
│  ├─ hooks/                    # client hooks only
│  ├─ types/                    # shared unions, enums, DTOs
│  └─ styles/                   # tokens.css + globals
├─ public/assets/
│  ├─ brand/                    # logo · wordmark · favicon · og-default
│  ├─ icons/
│  └─ placeholders/
├─ tests/
│  ├─ unit/                     # mirrors src/lib
│  └─ e2e/                      # Playwright specs
├─ docs/
│  ├─ SCHEMA.md                 # data model — source of truth for collections
│  ├─ DESIGN.md                 # design system, tokens, UI rules
│  ├─ FEATURES.md               # owner's feature inbox
│  └─ ARCHITECTURE.md           # written progressively as stages complete
└─ CLAUDE.md
```

### DRY rules with teeth
- Used in two places → move to the nearest shared folder. Third use → `components/ui/`.
- Two functions doing similar maths → one function with a parameter. No copy-paste.
- Anything an admin might ever change (shipping cap, free-shipping threshold, return window)
  is **config or DB, never a literal in code**.
- Every collection exports a matching type. Access rules live in `src/access/`, defined once, reused everywhere.

### Object-oriented design

Domain concepts are **classes with behaviour**, not bare data passed through loose functions.

- **Value objects** are immutable and self-validating — `Money` rejects fractional paise in its
  constructor, so an invalid amount cannot exist anywhere in the system. Every operation returns a
  new instance. Follow this pattern for `Sku`, `Pincode`, `Quantity`.
- **Encapsulation:** internal state is `private readonly`. Callers use methods, never raw fields.
  If something can be derived, expose a method — don't publish the field.
- **Program to interfaces.** Every integration is an interface plus an implementation:
  `PaymentGateway` ← `RazorpayGateway`, `ShippingProvider` ← `ShiprocketProvider`,
  `NotificationChannel` ← `EmailChannel` / `WhatsAppChannel`. Swapping a provider or mocking it in
  tests means one new class, not edits scattered across call sites.
- **Composition over inheritance.** Inherit only from an abstract base that exists purely to share
  behaviour (e.g. `BaseHttpClient` for retry and auth). Never build deep hierarchies.
- **Single responsibility.** A class does one job. When a service class starts needing "and" to be
  described, split it.
- **Dependency injection.** Classes receive their collaborators through the constructor. Nothing
  reaches for a global or constructs its own HTTP client — that is what makes them testable.
- Pure calculation functions still belong in `lib/` where no state or identity is involved. OOP is
  for things with behaviour and invariants; a stateless formula stays a function.

---

## 4. GIT & GITHUB

- Public repo, pushed from day one so progress is visible.
- Branch: `main`. Small, frequent commits — one logical change each.
- Commit format: `type(scope): summary` — `feat(cart): merge guest cart on login`.
  Types: `feat` `fix` `refactor` `test` `docs` `chore` `perf` `style`.
- **Commit body and footer carry no AI attribution of any kind.** See §2.
- Push at the end of every stage, and any time a session ends mid-stage.
- Never force-push `main`. Never commit `.env*`, `node_modules`, `.next`, or media.

---

## 5. TESTING POLICY

| Layer | Tool | Rule |
|---|---|---|
| `src/lib/**` | Vitest | **Mandatory.** Pure functions, table-driven cases, edge cases included |
| Collection hooks | Vitest + test DB | Stock decrement, order totals, status transitions |
| API routes / webhooks | Vitest | Signature verification, idempotency, malformed payloads |
| Access control | Vitest | Each role against each collection — allowed and denied |
| Critical flows | Playwright | Browse → variant select → cart → checkout → order |
| Components | Skipped for now | Revisit if UI regressions appear |

**Non-negotiable test cases:**
- GST split: intra-state CGST+SGST vs inter-state IGST, computed on `price × quantity`
- Coupon: min-cart, per-user limit, global limit, expiry, stacking
- Stock: the last unit cannot be oversold under concurrent add-to-cart
- Order total: subtotal + shipping + tax − discount − loyalty reconciles to the paise
- Webhook idempotency: the same payment event twice must not double-process
- Order status machine: every illegal transition throws
- Roles: `support_agent` cannot mutate orders; `catalog_manager` cannot issue refunds

Commands Claude runs itself (fast, safe, no side effects beyond the repo):
```
npm run check         # typecheck + lint + test — must pass before any stage is [x]
npm test              # unit + integration
```

### Commands the owner runs — do not spend session time on these

These are slow, interactive, or need a human looking at the result. **Claude must hand these over
rather than run them**, and say exactly what it expects to see.

```
npm run dev           # dev server — long-running, blocks a session
npm run test:e2e      # Playwright; boots its own dev server. Minutes, not seconds
npm run seed          # ~3 min against Neon. Re-run after a schema change
npm run build         # production build check
npm audit             # OWASP A06 dependency check
```

Anything **destructive or billable** is always the owner's to run, never Claude's:
database drops or resets, `payload migrate:fresh`, deploys, provisioning, and anything that
spends money on a provider.

When Claude finishes a stage it lists which of these to run and what a pass looks like.

---

## 6. THE JOURNEY

> Detailed tasks exist only for the active stage. Expand the next stage when you reach it.

### [x] J0 — Foundation
**Goal:** an empty but correct skeleton. Admin loads, tests run, structure enforced, repo live.

- [x] Next.js 16.2.7 + React 19.2.6 + TypeScript strict + Tailwind 4.3.3
- [x] Payload 3.86.0 with the Postgres adapter, pinned against a compatible Next
- [x] Neon Postgres connected; `.env.local` + `.env.example` with every key documented
- [x] Payload boots, `/admin` returns 200, schema pushed to Neon
- [x] Full folder tree from §3 created with `.gitkeep`
- [x] ESLint + Prettier + strict tsconfig (`noUncheckedIndexedAccess`); `npm run check` wired
- [x] Vitest green — 24 tests on the `Money` value object; Playwright green — 5 e2e specs
- [x] `.gitignore` covers `.env*`, `node_modules`, `.next`, `media`; README has setup steps
- [x] Pushed to GitHub
- [x] `docs/ARCHITECTURE.md` created with pinned versions

**Done:** `npm run check` and `npm run test:e2e` both pass; `/admin` works against Neon.

### [x] J1 — Data model
**Goal:** every collection in `docs/SCHEMA.md` exists, is access-controlled by role, has generated
types and a migration, and a fictional demo catalog seeds cleanly.

- [x] 22 collections (one file each) + `settings` global, listed once in `src/collections/index.ts`
- [x] Shared field builders in `src/collections/fields.ts` — slug, money-in-paise, SEO, address snapshot
- [x] `src/access/` — role matrix as data, actor resolution, Payload access functions.
      Customer scoping returns a `Where`, so another customer's row is never fetched
- [x] `src/lib/` — `utils/slug`, `inventory/sku`, `inventory/stock`, `inventory/syncStock` (+ Payload port)
- [x] Unique constraint on `(product, size, colour)`; indexes per `docs/SCHEMA.md`
- [x] `src/payload-types.ts` regenerated; migration `20260726_181320_j1_data_model` generated
- [x] `npm run seed` — 3 categories, 6 products, 76 variants, one staff account per role, demo
      customer. Idempotent, refuses production, reconciles stock against the ledger on the way out
- [x] OWASP pass: A01 every collection declares access, A04 stock/totals server-owned,
      A09 append-only ledgers for stock, order events and loyalty
- [x] `npm run check` green — 214 unit tests; `docs/ARCHITECTURE.md` §5 and §6 written

**Done:** `npm run check` passes; seed produces a browsable catalog with sold-out variants for J3.

### [ ] J2 — Admin usability
Bulk variant generator (pick sizes + colours → auto SKUs), stock adjustment writing to the movement
ledger, the five staff roles wired end to end, dashboard counters, CSV import/export.

### [ ] J3 — Storefront: browse
Home, category listing with URL-state filters (size, colour, price, availability), product detail with
colour-swapping gallery, size pills with sold-out visible-but-disabled, size chart modal, breadcrumbs.
Metadata + Product/BreadcrumbList JSON-LD on every page.

### [ ] J4 — Cart & checkout
DB-backed cart keyed to a session cookie, guest → customer merge on login, address book,
shipping rules, GST, coupons, Razorpay order creation, webhook with idempotency, confirmation page.

### [ ] J5 — Orders & fulfilment + scheduler
Order status machine, Shiprocket create/track/cancel, AWB storage, delivery webhook, and one
scheduler registry (abandoned cart, status sync, stock alerts, review requests) on secret-protected cron routes.

### [ ] J6 — Notifications: email + WhatsApp
Single `notify.dispatch(event, payload)` API with Resend and Meta WhatsApp Cloud API adapters.
Templates: placed, confirmed, shipped, out for delivery, delivered, cancelled, refund, abandoned cart,
back-in-stock, review request. Every send logged; failures never block the order flow.

### [ ] J7 — Customer support + Claude assistant
Ticket collection, customer "My Requests" view, admin inbox with reply and assignment.
Claude-powered assistant (`ANTHROPIC_API_KEY`) grounded in the live catalog and the signed-in
customer's own orders, with strict data scoping, rate limiting, cost caps, and clean handoff to a human ticket.

### [ ] J8 — Account, returns & loyalty
Auth, order history with status timeline, wishlist with back-in-stock alerts, reviews with photos and
fit feedback, returns and **size exchange**, loyalty points.

### [ ] J9 — SEO & performance
Sitemap, robots, canonicals, OG image generation, Core Web Vitals pass, image pipeline,
caching and revalidation strategy, structured data validation, Lighthouse ≥ 95.

### [ ] J10 — Launch
AWS provisioning, S3 media, build in CI (never on the app instance), migrations, secrets,
monitoring, backups, go-live checklist.

---

## 7. OPEN DECISIONS (owner input needed)

- [ ] Final brand name and domain — `Threadline` is a placeholder; repo renames cleanly later
- [ ] Logo. The accent is currently mulberry `#b04b76` — change the four `--brand-*` values in
      `src/styles/tokens.css` to rebrand the entire storefront
- [ ] Razorpay account and Shiprocket account — existing or new?
- [ ] WhatsApp Business number and Meta Business verification status
- [ ] Return window in days, and who pays return shipping
- [ ] Launch scope — one category to start, or the full catalog?

---

## 8. SESSION LOG

- 2026-07-26: Project initialised. Stack decided (Next.js 16 + Payload 3 + Postgres + AWS).
  `CLAUDE.md`, `docs/SCHEMA.md`, `docs/DESIGN.md`, `docs/FEATURES.md` written.
  Journey J0–J10 defined, J0 expanded. Planning only — no application code yet.
- 2026-07-26 [J0]: Foundation complete. Payload 3.86 + Next 16.2.7 on Neon Postgres, admin live.
  Structure from §3 built out. `Money` value object with 24 unit tests; 5 Playwright e2e specs green.
  Design tokens with light/dark and a single-point rebrand (mulberry `#b04b76`).
  OWASP Top 10 baseline and OOP design rules added to §2/§3 (replacing the earlier "WASP" note).
- 2026-07-27 [J1]: Data model complete. 22 collections + `settings` global, all wired through
  `src/collections/index.ts`. Access control in `src/access/` — role matrix as data, customer
  scoping via `Where` constraints, `users.role` locked to super_admin. 214 unit tests
  (up from 24): slug, SKU, stock ledger, stock sync, the full role × resource matrix, and access
  per role. Migration `20260726_181320_j1_data_model` generated; dev schema pushed to Neon.
  `npm run seed` builds 6 products / 76 variants, idempotent and self-reconciling.
  Caught and fixed: nested Local API queries in a collection hook must carry `req` or they miss
  the open transaction and write `stockQty: 0` over good data — hence `payloadLedger.ts`.
  §5 gained an owner-run command list so slow work stops costing session time.
  **Next: J2 — admin usability.**
