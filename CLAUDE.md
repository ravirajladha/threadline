# Threadline — CLAUDE.md (Master Journey File)

> Loaded automatically on every session start.
> Work the **Journey** below top to bottom. One stage at a time. Mark `[x]` only when the
> stage's tests pass. Update the Session Log at the end of every session.
> Created: 2026-07-26 · Last updated: 2026-07-27

---

## 0. HOW THIS FILE WORKS (read first, every session)

This file is a **loop**, not a document. Each session:

1. Read this file, then read `docs/FEATURES.md` for anything new in its Inbox.
2. Find the first stage that is not `[x]`.
3. If that stage has no task list yet → **expand it first** (write its tasks in), then start.
4. Do the tasks. Write the tests. Run them. Fix until green.
5. Mark `[x]`, commit, push, append one line to the Session Log.
6. When tokens run low → stop cleanly, log exactly where you stopped.

### Token budget — checkpoint before you run out

A session that dies mid-stage with uncommitted work has cost tokens and delivered nothing. So
**checkpointing is a scheduled task, not an emergency response**:

| Budget used | Do this |
|---|---|
| **~50%** | Stop starting new parallel work. Finish and integrate what is already in flight |
| **~75%** | **Checkpoint now.** Run `npm test`, commit everything green, push, write the Session Log entry. Only then carry on |
| **~90%** | Stop building. Leave the tree committed and the log accurate. Write the next session's first task as an explicit line in the log |

Rules for a checkpoint commit mid-stage:
- Commit **working, tested code** freely — a partially built stage is normal and the journey
  expects it. Never mark the stage `[x]`.
- If something does not typecheck yet, say so in the commit body and in the Session Log. Never
  claim a stage passed `npm run check` when it has not been run.
- The Session Log entry must name **the exact next action**, not a vague area — "wire
  `ListingView` to the components in `src/components/catalog/`", not "continue J3".

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

### Build order — stub the outside world first (owner's decision, 2026-07-27)

The whole customer journey is built and walkable **before** a single third-party account is
connected. Every external provider ships first as a **stub adapter behind its real interface**,
returning the happy-path answer, so browse → cart → checkout → order → account works end to end
on a laptop with no keys, no spend and no vendor onboarding blocking progress.

| Surface | Now | Later |
|---|---|---|
| Payments | `StubGateway implements PaymentGateway` — always succeeds, fabricates a payment id, fires the same webhook shape | `RazorpayGateway` |
| Login | Static OTP (`000000`) accepted in development, real session cookie issued | Real OTP delivery |
| Email | `ConsoleChannel implements NotificationChannel` — renders the template, logs it, writes the `notifications` row | Resend |
| WhatsApp | Same stub channel | Meta Cloud API |
| Shipping | `StubShippingProvider` — fabricates an AWB, advances tracking on demand | Shiprocket |
| Media | Locally generated sample images, uploaded through the normal media pipeline | Real photography on S3 |

**Rules that keep this honest:**
- A stub implements the *same interface* as the real thing and lives beside it in `src/lib/`.
  Swapping it later is one line in a factory — never a rewrite of the call sites.
- Stubs are selected by environment, never by a branch inside business logic. A stub must be
  **impossible to reach in production**: the factory throws at startup if `NODE_ENV=production`
  and no real provider is configured.
- The happy path being stubbed does not excuse skipping the failure paths in *our* code —
  signature verification, idempotency by event id, and the order status machine are all built
  for real now, and tested against the stub's payloads.
- Simple CRUD first, the hard integrations one at a time afterwards, as stage **J11**.

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

### [x] J2 — Admin usability
**Goal:** the admin is usable by a non-technical owner. Adding a product with 15 variants is one
action, not fifteen; stock is corrected without touching the ledger by hand; each role sees only
what it can act on.

- [x] `src/lib/inventory/variantMatrix.ts` — idempotent size × colour expansion with generated SKUs
- [x] `src/lib/inventory/adjustment.ts` — "count says N" / "N arrived" / "N damaged" → the signed
      ledger movement that expresses it; a no-op returns null rather than writing an empty row
- [x] `src/lib/csv/` — RFC 4180 serialise + parse, then a catalog mapper that reports every bad
      row at once with its spreadsheet line and column. Money crosses in rupees, via `Money`
- [x] `src/access/adminUI.ts` — nav filtered by the role matrix, bound centrally in
      `src/collections/index.ts`; a test asserts nav and access agree for every role × resource
- [x] Endpoints in `src/endpoints/` — generate variants · adjust stock · export CSV · import CSV.
      Every one re-checks the role (a custom endpoint bypasses collection access) and is wrapped
      in `safeHandler`, so a database error cannot return SQL and a stack trace to the caller
- [x] Admin UI: variant generator, stock adjuster, dashboard counters; import map regenerated
- [x] OWASP pass: A01 role re-checked per endpoint, A04 stock only ever appends to the ledger and
      identity columns are not importable, A05 error boundary on every handler
- [x] `npm run check` green — 351 unit tests; `docs/ARCHITECTURE.md` §7 written

**Done:** verified against the dev database — all three adjustment modes, a lossless 76-row CSV
round trip, and `support_agent` refused on every endpoint.

### [x] J3 — Storefront: browse
**Goal:** a customer can find a garment. Home → category → product, with filters that survive a
refresh and a share, and a product page that answers "will this fit me" before it asks for a sale.

Routes: `/` · `/shop` · `/c/[slug]` (category) · `/p/[slug]` (product).

- [x] `src/lib/catalog/filters.ts` — URL search params ⇄ typed `CatalogFilters`. Untrusted input:
      garbage is dropped, never thrown on. Canonical serialisation (sorted, defaults omitted) so
      one filter set has one URL. Toggling a facet resets the page
- [x] `src/lib/catalog/query.ts` — filters → Payload `Where` + sort. Two-phase: variants match the
      facets, products are paginated by the resulting id set. Only `active` products, `isActive`
      variants. Price handles the variant-overrides-mrp fallback
- [x] `src/lib/catalog/variantView.ts` — depth-populated variants → flat, serialisable view models.
      Availability is `stockQty − reservedQty`, floored at zero
- [x] `src/lib/catalog/productView.ts` — colour swatches, size pills (in `sortOrder`, sold-out
      flagged not hidden), default colour selection, price range, "Only N left"
- [x] `src/lib/catalog/gallery.ts` — images for the selected colour, with a defined fallback chain
- [x] `src/lib/catalog/breadcrumbs.ts` — category ancestry → crumbs, cycle-safe
- [x] `src/lib/seo/metadata.ts` — Next `Metadata` from a doc + its `seo` override; filtered
      listings canonicalise to the clean category URL
- [x] `src/lib/seo/jsonLd.ts` — Product · BreadcrumbList · Website builders, plus the `<` escaping
      that makes embedding them in a `<script>` safe (A03)
- [x] `src/lib/catalog/payloadCatalog.ts` — the Payload port behind a typed `CatalogPort` interface
- [x] Components: `layout/` Header · Footer · Breadcrumbs · `ui/` Price · Swatch · Modal ·
      `catalog/` FilterRail · SortSelect · ActiveFilters · Pagination · ProductGrid ·
      `product/` ProductCard · Gallery · VariantPicker · SizeChartModal
- [x] Security headers in `next.config.ts` (A05) — the first stage that serves public pages
- [x] OWASP pass: A03 JSON-LD escaped at the boundary, A04 stock read server-side and never from
      the query string, A05 headers + no draft/archived product reachable by slug
- [x] `npm run check` green — 746 unit tests; `docs/ARCHITECTURE.md` §8 written

**Done:** every filter combination is a shareable URL, a sold-out size is visible and disabled, and
each page carries metadata plus valid structured data.

### [x] J4 — Cart & checkout *(stubbed payment)*
**Goal:** a customer can buy. Cart lives in the database against a session cookie, survives login,
re-prices itself server-side, reserves stock before payment and becomes an order whose totals
reconcile to the paise. Payment is a `StubGateway` — but the signature check, the idempotency and
the status machine around it are real.

Routes: `/cart` · `/checkout` · `/checkout/success`. API: cart mutations · `/api/webhooks/payments`.

**Pricing — `src/lib/pricing/`** (pure, the heaviest tested layer in the project)
- [x] `tax.ts` — `taxJurisdiction(sellerState, shippingState)` then the split: CGST+SGST within
      the state, IGST across it, **never both**. The halves are floor + remainder, not two
      roundings, so cgst + sgst equals the tax exactly
- [x] `shipping.ts` — free at or above the threshold, flat rate below, COD fee, and a
      `free_shipping` coupon that zeroes it. Every number comes from `settings`, none from code
- [x] `coupon.ts` — one evaluator returning either a discount or a **typed reason** it was
      refused: inactive · not started · expired · min cart · total limit · per-user limit · no
      eligible items. Scoped coupons discount only the lines they apply to
- [x] `loyalty.ts` — earn per rupee, 1 point = ₹1, capped at a percentage of the cart, a minimum
      to redeem at all, and never more than the balance
- [x] `totals.ts` — the composer. Asserts its own invariant: subtotal + shipping + tax − discount
      − loyalty = grandTotal, to the paise, or it throws rather than writing a wrong order

**Cart — `src/lib/cart/`**
- [x] `types.ts` — `CartView` / `CartLineView` / `CartPort`, plain serialisable data
- [x] `lines.ts` — add · update · remove over an item list, merging a repeat variant instead of
      duplicating it, clamped to what is actually available
- [x] `merge.ts` — guest cart ∪ customer cart on login. Quantities sum, then clamp
- [x] `cartView.ts` — re-prices every line from the variant (A04) and flags a price that moved
      since it was added, rather than silently charging the new one
- [x] `session.ts` — opaque session id, cookie name and options in one place
- [x] `payloadCart.ts` — the port. All mutations go through it; the collection stays `create: denyAll`

**Stock reservation — `src/lib/inventory/`**
- [x] `reservation.ts` — pure plan: lines + stock → reservations, or the shortages that block them
- [x] `payloadReservation.ts` — applies the plan inside a transaction. The guarantee is **one
      conditional `UPDATE`**, not a re-read: check and take are the same statement, so zero rows
      updated *is* the shortage and the last unit cannot be sold twice under concurrent checkout

**Orders — `src/lib/orders/`**
- [x] `transitions.ts` — the status machine. Every illegal transition throws; terminal states are
      terminal. Payment status has its own smaller machine
- [x] `orderNumber.ts` — deterministic, human-quotable, no PII
- [x] `draft.ts` — priced cart + addresses → the order row and its fully snapshotted items
- [x] `payloadOrders.ts` — place, transition (writing an `orderEvents` row every time), and the
      idempotency check that makes a replayed webhook a no-op. Both `transition` and
      `applyPaymentEvent` take `SELECT … FOR UPDATE` on the order row **before** reading the state
      they decide on — the check-then-act is otherwise racy under READ COMMITTED

**Payments — `src/lib/payments/`**
- [x] `types.ts` — `PaymentGateway`, `PaymentIntent`, `PaymentEvent`
- [x] `signature.ts` — HMAC-SHA256, compared in constant time
- [x] `stubGateway.ts` — always succeeds, fabricates ids, and **signs its webhook for real**
- [x] `factory.ts` — selects by environment and throws at startup if production has no real gateway

**Surfaces**
- [x] `src/lib/http/` — `rateLimit.ts` (sliding-window limiter, injected clock) and `route.ts`
      (error boundary, body narrowing, limit enforcement) — the App Router counterpart to
      `endpoints/guards.ts`
- [x] `/api/cart` — one endpoint, action-discriminated, rate-limited, cart identified only by the
      session cookie so another cart is not expressible in the request
- [x] `/api/checkout` — re-prices with the delivery state, reconciles, holds stock, writes the
      order. Marks nothing paid
- [x] `/api/webhooks/payments` — verify signature → parse → idempotent apply. Unverified is a 400
      and nothing else
- [x] `/api/payments/simulate` — development only, feeds a genuinely signed webhook through the
      real handler so the local happy path runs over verification rather than around it
- [x] Components: `cart/` CartLine · CartSummary · CartView · `checkout/` AddressForm ·
      OrderSummary · CouponBox · PaymentStep · StubPaymentPanel
- [x] Routes: `/cart` · `/checkout` · `/checkout/pay` · `/checkout/success` · `/checkout/failed`
- [x] Storefront chrome finally mounted — `Header` (live bag count) and `Footer` were built in J3
      but never rendered; `(storefront)/layout.tsx` now carries them plus `ThemeScript` and a skip
      link. Add-to-bag wired in `VariantPicker`; `/` replaced the J0 placeholder
- [x] OWASP pass: A01 a cart and an order are readable only by their owner or staff, A04 server
      re-prices and reserves, A08 signature + idempotency by event id, A09 every payment event logged.
      Verified against the code, not the comments — A01 traced down to the collection `access`
      functions (Payload exposes REST/GraphQL for `carts` and `orders` whatever the routes do), A08
      found and fixed a real race, A09 confirmed no PII in any log line. A07 gap raised in
      `docs/FEATURES.md`: `x-forwarded-for` is client-settable, so the limiter is bypassable
- [x] `npm run check` green — 1108 unit tests; `npm run build` green
- [x] `docs/ARCHITECTURE.md` §9 written

### [ ] J5 — Orders & fulfilment + scheduler *(stubbed courier)*
Order status machine, `ShippingProvider` interface with a **`StubShippingProvider`** that
fabricates an AWB and advances tracking on demand, delivery webhook, and one scheduler registry
(abandoned cart, status sync, stock alerts, review requests) on secret-protected cron routes.

### [ ] J6 — Notifications *(stubbed delivery)*
Single `notify.dispatch(event, payload)` API with a **`ConsoleChannel`** that renders the template,
logs it and writes the `notifications` row. Templates: placed, confirmed, shipped, out for delivery,
delivered, cancelled, refund, abandoned cart, back-in-stock, review request. Every send logged;
failures never block the order flow. Resend and WhatsApp adapters land in J11.

### [ ] J7 — Customer support *(assistant deferred)*
Ticket collection, customer "My Requests" view, admin inbox with reply and assignment — plain CRUD,
no spend. The Claude-powered assistant moves to J11, since it is the one feature that cannot be
stubbed usefully and costs money per message.

### [ ] J8 — Account, returns & loyalty *(static OTP)*
Auth with a static development OTP, order history with status timeline, wishlist with back-in-stock
alerts, reviews with photos and fit feedback, returns and **size exchange**, loyalty points.

### [ ] J9 — SEO & performance
Sitemap, robots, canonicals, OG image generation, Core Web Vitals pass, image pipeline,
caching and revalidation strategy, structured data validation, Lighthouse ≥ 95.

### [ ] J10 — Launch
AWS provisioning, S3 media, build in CI (never on the app instance), migrations, secrets,
monitoring, backups, go-live checklist.

### [ ] J11 — Live integrations *(replaces the stubs, one provider at a time)*
Each provider is a separate commit and a separate decision to spend. The interface and its tests
already exist from J4–J7, so each swap is one new class plus its contract test.
Order: Razorpay → Resend → real OTP delivery → Shiprocket → WhatsApp Cloud API → Claude assistant.
Every one keeps its stub, which is what the test suite and local development continue to run against.

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
- 2026-07-27 [J2]: Admin usability. Bulk variant generator, stock adjustment through the ledger,
  catalog CSV import/export, role-aware nav, dashboard counters. 351 unit tests (up from 214) —
  the CSV parser is hand-written and carries the weight of that, since a naive split corrupts
  exactly the rows a clothing catalog is full of.
  Endpoints verified against the dev database, not just typechecked: all three adjustment modes,
  a lossless 76-row CSV round trip, every validation path, and `support_agent` refused on each.
  That run also found two real gaps, both fixed: handlers had no error boundary, so a database
  error returned the failing SQL to the caller, and `actor` was taking `req.user.id` without
  checking it was a staff id. `safeHandler` and `staffIdOf` now cover both.
- 2026-07-27 [J3, part 1 of 2]: Storefront browse — **the whole logic layer, none of the UI yet.**
  741 unit tests, up from 351. Shipped and green: `catalog/` — `types.ts` (the `CatalogPort`
  contract every page depends on), `filters.ts` (URL ⇄ typed filters, canonical serialisation,
  hostile input dropped not thrown on), `query.ts`, `select.ts` (filter · facet · sort · paginate),
  `variantView.ts`, `productView.ts`, `gallery.ts`, `breadcrumbs.ts`, `categoryTree.ts`,
  `payloadCatalog.ts`, `server.ts`; `seo/` — `metadata.ts` and `jsonLd.ts`; security headers and
  a CSP in `next.config.ts`.
  Two decisions worth remembering. **Facets constrain a variant, not a product** — "M" plus
  "blue" must mean a blue M exists, so filters run over the variant list and a product survives
  only if something is left. And **a facet is never counted against itself**, which is the
  difference between a working filter rail and the familiar broken one where every unticked
  option reads zero.
  The listing is served from one cached catalog read per request rather than a query per facet,
  because SQL cannot order by a price that falls back to the product MRP. That trade has a
  ceiling and `loadCatalogIndex` is the seam where J9 replaces it.
  Owner's decision this session, now §2 "Build order — stub the outside world first": the entire
  customer journey gets built against stub adapters before any provider is connected. J4–J7
  retitled accordingly; real integrations become J11, one provider per commit.
  The seed generates its own sample product photography now — 4:5 WebPs composed with `sharp`
  from the colour's own hex, matched by filename so a re-run reuses them. Fictional by
  construction, which is the only kind of image a public repo can commit against.
  **Not done, and the exact next action:** the storefront components
  (`src/components/{ui,layout,catalog,product}/`) were still being
  written when the session ended, so `src/components/catalog/ListingView.tsx` and the four routes
  under `src/app/(storefront)/` are committed but **do not typecheck yet** — they import
  components that do not exist. Next session: land those components, then run `npm run check`
  until green and mark J3 `[x]`. `npm run check` has NOT been run this session; `npm test` is
  green at 741.
- 2026-07-27 [J3, part 2 of 2]: **Stage closed.** `npm run check` fully green — typecheck, lint and
  746 unit tests (up from 741). `docs/ARCHITECTURE.md` §8 written; the pending sections renumbered
  around it.
  Three defects cleared. **The seed could not create a login**, because staff accounts were the
  last thing it did and sample-image generation — the slowest, most optional and most
  failure-prone step, being the only one that leaves the database — sat in front of them inside
  the product loop. Accounts now run first, before the catalog exists at all, and the gallery
  step is wrapped per product: a failure names the product, warns, and the run carries on, with a
  count in the closing summary. A store with no placeholder images is usable; a store nobody can
  log into is not.
  On the throw itself, honestly: **it does not reproduce here.** Every one of the 32 images
  rasterises, `sharp` reports rsvg 2.59.91 and the text renders; a media upload through the real
  Payload pipeline succeeds; and the dev database already holds all 32 media rows, six products,
  76 variants and all five staff accounts. So the ordering fix stands on its own merits rather
  than on a diagnosis. What did come out of looking is a real inefficiency and a real blind spot:
  the seed rendered every image *before* checking whether the media row already existed, so a
  re-run paid for 32 rasters it then discarded — which is most of why a re-seed took minutes.
  `planSampleImages` now names and composes an image for the cost of a string, and
  `renderPlannedImage` is called only once the lookup has proved the raster is needed. A test
  pins planned filenames to rendered ones, because a drift between the two would silently double
  every gallery. `rasterise` also names the image it failed on and keeps the original as `cause`
  — a bare `sharp` message in a 32-image run says nothing about which one.
  **Four lint errors**, all the same mistake: `useEffect` copying props into state. Fixed by
  deriving during render, not by disabling the rule. `Gallery` tracks the chosen image *id* rather
  than its index, so a colour change simply stops matching; `VariantPicker` keeps the customer's
  explicit size and resolves the effective one against the current pill set, with quantity clamped
  to what is actually available; `FilterRail`'s price box is remounted by `key`; `ThemeToggle` reads
  the DOM and `localStorage` through `useSyncExternalStore`, which is what that hook is for and
  which also makes the icon follow a live OS theme change. Three stale `react/no-danger`
  directives removed, reasoning comments kept.
  **Next: J4 — cart and checkout**, against a `StubGateway` per §2 "Build order — stub the outside
  world first". Signature verification, idempotency by event id and stock reservation are all
  built for real against the stub; Razorpay itself is J11.
- 2026-07-27 [J4, surfaces]: **The journey is walkable end to end.** `npm run check` green at 1101
  unit tests (up from 1072) and `npm run build` green across all 18 routes. The stage is *not*
  marked `[x]` — see the two open items above.
  The session's finding, and it was not a small one: **`Header` and `Footer` had never been
  rendered.** J3 built them, `(storefront)/layout.tsx` still returned a bare `<main>`, and nothing
  grepped for them. So every page since J3 has shipped with no navigation, no footer and no
  `ThemeScript` — which is the flash of the wrong theme on every cold load, and most likely the
  real reason the deployed site reads as unstyled rather than anything to do with the tokens.
  The layout now carries all three plus a skip link. `VariantPicker`'s buy button, which read
  "Coming in J4" and was `disabled`, now adds to the bag; without it `/cart` would have been a
  permanently empty page.
  New in `src/lib/http/`: a **sliding-window** rate limiter rather than a fixed one, because a
  fixed window lets a caller spend one allowance at 0:59 and the next at 1:01 — double the rate
  across exactly the boundary a script will find. Clock injected, so the boundary case is a test
  rather than a sleep.
  `postCartAction` moved from `CartView.tsx` to `lib/cart/client.ts`, which its own comment had
  asked for on the third caller; add-to-bag was the third.
  Two defects the tests caught rather than production. **`toQty` used `Number(value)`**, which
  coerces `null`, `''` and `false` to *zero* — and zero is the cart's spelling of "remove this
  line", so a `setQty` with a missing quantity would have silently deleted a customer's line
  instead of returning a 400. The route's own comment claimed this was handled; it was not, until
  the test asserted it. And **`recentOrder.ts` shipped a second order-number regex** expecting
  `YYYYMMDD` when the real format is `YYMMDD` — it would have rejected every genuine order number
  and shown "no recent order" after every successful checkout. Now defers to
  `orderNumber.isOrderNumber`.
  Design decisions worth keeping. **An order number never authorises reading an order** — it is a
  date plus a small sequence, so counting upwards would hand out strangers' addresses. The
  confirmation pages read an httpOnly `tl_order` cookie and never the URL, which makes the obvious
  attack unexpressible rather than merely blocked. `SameSite=Lax` on it deliberately, because
  `Strict` is withheld on the cross-site return from a gateway — the confirmation page would come
  up blank for everyone who actually paid. And `/api/payments/simulate` does **not** call
  `applyPaymentEvent`; it signs a body for real and hands it to the webhook route, so the local
  flow exercises verification instead of bypassing it.
  `.env.example` documented `RAZORPAY_WEBHOOK_SECRET`, which nothing reads. The factory reads
  `PAYMENT_PROVIDER` and `PAYMENT_WEBHOOK_SECRET`; both are now documented.
  **Exact next action:** run the OWASP A01/A04/A08/A09 pass over the four new routes, then write
  `docs/ARCHITECTURE.md` §9, then mark J4 `[x]`. Owner to run `npm run seed` (schema unchanged, so
  only if the catalog is stale) and `npm run test:e2e` — no e2e spec covers cart → checkout yet,
  so that suite still only proves J3.
- 2026-07-27 [J4, closed]: **Stage complete.** `npm run check` green — typecheck, lint and 1108 unit
  tests (up from 1101). `docs/ARCHITECTURE.md` §9 written, retitled "Cart, checkout and orders":
  the stub section had been scoped as "Payments — Razorpay", which is a fraction of what J4 actually
  delivered.
  The OWASP pass was run against the code rather than against the comments, which is the only
  version of it worth doing — every one of these four routes documents its own security properties
  in a header block, and a header block is a claim, not evidence. Three of the four claims held.
  **A08 did not, and the defect was real.** `applyPaymentEvent` read the processed-event trail,
  decided, then wrote — a check-then-act sequence, and Postgres defaults to READ COMMITTED. Two
  concurrent deliveries of the same event both read a trail without the event id *and* both read
  `paymentStatus: 'pending'`, so neither the duplicate-event guard nor the already-paid guard fires.
  The order is confirmed twice, two audit rows are written, and **the stock is sold twice**. Payment
  providers retry as a matter of course, so this needed no attacker. The pure decision in
  `paymentApply.ts` was correct throughout; what was wrong was the read feeding it.
  Fixed with `SELECT … FOR UPDATE` on the order row taken *before* anything is read, in both
  `applyPaymentEvent` and `transition` — the same shape of bug, and `transition` now opens a
  transaction when it was not given one, because a lock outside a transaction is released at once
  and guarantees nothing. `clientFor` and the driver-shape helpers moved out of
  `payloadReservation.ts` into `lib/utils/drizzle.ts` on their second use, per §3.
  On testing it honestly: a concurrency test that passes proves nothing until it has been seen to
  fail, so the fake models the one Postgres behaviour the fix rests on — a row lock held until
  commit — and serialises nothing by itself. Verified by neutralising the locks and re-running: the
  race test reports `[ 'apply', 'apply' ]` and six of seven fail. Writes in the fake become visible
  immediately rather than at commit, which is weaker than Postgres and deliberately so — it can only
  flatter an unlocked implementation, never fake a failure.
  Worth recording what the pass confirmed rather than changed, since these are the properties a
  later refactor could quietly break: A01 holds at the **collection** layer, not just in the route
  handlers — which matters because Payload exposes REST and GraphQL for `carts` and `orders`
  regardless of what our own routes do, and `ownScopedRead` returns `false` for anonymous callers
  and a `Where` owner constraint for customers. The stock guarantee is the conditional `UPDATE`, not
  the re-read the journey line had claimed; that line is corrected. A09 logs carry event id, type,
  order number and decision, and no PII.
  **One gap left open deliberately, in `docs/FEATURES.md` under Needs Input.** `clientKey` identifies
  a caller by the left-most `x-forwarded-for` entry, which the client sets — so a script rotating
  that header gets a fresh allowance per request and the coupon-apply limit, whose entire purpose is
  to stop code guessing, is bypassed. The fix is to count from the right past the proxies we control,
  and that hop count is a fact about the deployment: too few leaves the bypass open, too many buckets
  every visitor behind one edge node together and starts refusing real shoppers. Not a guess to make
  unilaterally.
  Also confirmed this session, from the owner's screenshots: **CI red is a billing lock, not code.**
  The check-run annotations API says "The job was not started because your account is locked due to a
  billing issue" and reports `"steps": []` — nothing ran, which is why all nine runs die at 3s.
  Clear it at github.com/settings/billing; Railway deploys are unaffected.
  **Next: J5 — orders & fulfilment + scheduler**, against a `StubShippingProvider`. Owner to run
  `npm run test:e2e` (still only proves J3 — no spec covers cart → checkout yet, and that gap is now
  the largest untested surface) and `npm run build`. `npm run seed` only if the catalog is stale;
  the schema did not change this session, so no migration was generated.
