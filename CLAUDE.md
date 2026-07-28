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

**Archive the log as you go.** When a stage closes, move the session-log entries for the stage
*before* it into `docs/SESSION-LOG.md`, leaving roughly the last two here. §8 exists to answer
"where did the last session stop" — it is not the project's history, which is `docs/ARCHITECTURE.md`
and the git log. Left alone it grows without bound: by J7 it was 38k characters, half this file, and
every session paid for all of it. Nothing is deleted, only moved out of the always-loaded file.

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

Run `ls` — the tree is what it is. What matters, and what the tree cannot tell you, is below.

Load-bearing placements: business rules live in `src/lib/*` (never in components or admin config),
every external provider sits behind an interface in `src/lib/<domain>/` with a stub beside it, access
rules live once in `src/access/`, and `tests/unit/` mirrors `src/lib/`.

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
Next 16 + React 19 + TypeScript strict + Payload 3.86 on Postgres, admin live, folder tree from §3
built out, ESLint/Prettier/`npm run check` wired, Vitest and Playwright green, repo pushed.
`docs/ARCHITECTURE.md` §1–§4.

### [x] J1 — Data model
22 collections + the `settings` global, `src/access/` with the role matrix as testable data and
customer scoping via `Where` constraints, stock as an append-only ledger, migration
`20260726_181320_j1_data_model`, idempotent demo seed. `docs/ARCHITECTURE.md` §5–§6.

### [x] J2 — Admin usability
Bulk variant generator, stock adjustment through the ledger, catalog CSV import/export, role-aware
nav, dashboard counters. Every endpoint re-checks the role and carries an error boundary, because a
custom endpoint bypasses collection access. `docs/ARCHITECTURE.md` §7.

### [x] J3 — Storefront: browse
`src/lib/catalog/` behind a `CatalogPort` — URL-canonical filters, variant-level faceting (a facet is
never counted against itself), gallery and breadcrumbs; `src/lib/seo/` metadata and JSON-LD with
boundary escaping; security headers and CSP; the four public routes. `docs/ARCHITECTURE.md` §8.

### [x] J4 — Cart & checkout *(stubbed payment)*
Pricing (GST split, coupons, loyalty, a self-checking totals composer), a database cart that survives
login, stock reserved by one conditional `UPDATE`, the order status machine, and a signature-verified
idempotent payment webhook against `StubGateway`. The A08 pass found a real race: `applyPaymentEvent`
read-then-wrote under READ COMMITTED, so a retried event sold the stock twice — fixed with
`SELECT … FOR UPDATE` taken before any read. `docs/ARCHITECTURE.md` §9.

### [x] J5 — Orders & fulfilment + scheduler *(stubbed courier)*
Staff fulfilment through the row lock and the status machine, courier tracking applied idempotently by
event id, and one job registry behind a secret-protected `/api/cron/[job]`. `status-sync` deliberately
does not poll — a webhook-only courier cannot answer — so it reports parcels that have gone *quiet*,
which is the failure a missed webhook has no other signature for. `docs/ARCHITECTURE.md` §10–§11.

### [x] J6 — Notifications *(stubbed delivery)*
One `dispatch(event, payload)`, ten templates and a `ConsoleChannel` behind a `NotificationChannel`
interface. Status messages fire from `transition` and `applyPaymentEvent`, so coverage is structural;
`order.placed` comes from checkout. Idempotent by subject, never throws, and the console channel is
refused in production. J5’s `queue.ts` absorbed; the four jobs re-pointed. `docs/ARCHITECTURE.md` §12.

### [x] J7 — Customer support *(assistant deferred)*
Tickets with a derived status — an agent reply moves a thread to waiting-on-customer, a customer
reply brings it back, `firstResponseAt` stamps once. Ownership checked on every lookup, because a
ticket number travels in emails and authorises nothing. `/api/support`, three admin endpoints, the
customer thread pages and the agent panel. The security pass closed `tickets.create` to customers,
which had let a signed-in customer POST a fabricated “Threadline Support” message into their own
thread. `docs/ARCHITECTURE.md` §13. The Claude assistant remains J11.

### [ ] J8 — Account, returns & loyalty *(static OTP)*
**Goal:** the customer gets an account. They sign in, see their orders and where each one is, send
one back or swap it for another size, review what they kept, and watch their points. Everything the
storefront has been building against a session cookie since J4 finally has a customer behind it.

**No migration expected** — `returns`, `reviews`, `wishlists` and `loyaltyTransactions` all exist
from J1, `customers` is already an auth collection, and the dev OTP is a fixed string that needs no
storage. Confirm this before starting each part rather than assuming it; if a field is genuinely
missing, generate the migration then, not retroactively.

Build in this order: nothing else works without a session.

**Auth — `src/lib/auth/`** *(the seam is `customerSession.ts` from J7)*
- [x] `otp.ts` — `OtpChannel` interface plus `StubOtpChannel`: requesting always succeeds, `000000`
      verifies, and a real code is never stored because there is none. J11 swaps in delivery and a
      hashed code with an expiry; the *shape* of verification is built for real now
- [x] `factory.ts` — selects by environment, throws in production, as the other three factories do
- [x] `login.ts` — pure: the decisions around a login attempt. **No user enumeration** — "we've sent
      a code" is the answer whether or not the address exists (A07). Attempts are counted and a
      lockout is a typed refusal, not a thrown error
- [x] `/api/auth` — request-code · verify · logout, rate-limited per address *and* per IP, session
      issued through Payload so the cookie is httpOnly and SameSite by its own config (A02/A07)
- [x] Guest cart merges into the customer's on login — `cart/merge.ts` exists and is tested from J4,
      so this is wiring, not new logic

**Account — `src/app/(storefront)/account/`**
- [x] `/account` shell with the signed-out state J7 already renders, now backed by a real login
- [x] `/account/orders` and `/account/orders/[number]` — history and one order. The timeline reads
      `orderEvents`, which has been the audit trail since J4, so the customer sees exactly what the
      system recorded rather than a second story kept in parallel
- [x] The order number still authorises nothing: scoped by session, same rule as tickets

**Returns and exchange — `src/lib/returns/`**
- [x] `eligibility.ts` — pure: delivered, inside `settings.returnWindowDays`, not already returned,
      per line rather than per order. A typed reason for every refusal
- [x] `transitions.ts` — the return status machine over the six `RETURN_STATUSES`
- [x] `exchange.ts` — a size swap is a return *plus* a reservation against the new variant, and the
      reservation has to hold before the parcel is collected or the exchange is a promise we cannot
      keep. Reuses `inventory/reservation.ts`
- [ ] `payloadReturns.ts` — raise · approve · receive · refund, role-checked, stock returned to the
      ledger only on `received` (goods inspected first, per the J5 note)
- [ ] `/api/returns` and the customer flow under `/account/orders/[number]`

**Reviews — `src/lib/reviews/`**
- [ ] `eligibility.ts` — only a delivered order, one review per product per customer, and the
      purchase is verified from the order rather than claimed by the request (A04)
- [ ] `summary.ts` — average rating, distribution, and the fit histogram that makes "runs small"
      a number on the product page rather than a comment somebody has to read
- [ ] Submission with photos through the existing media pipeline; `status` gates publication
- [ ] Product page shows the summary and the published reviews — the first J3 surface to change

**Wishlist and loyalty**
- [ ] `/account/wishlist` — add, remove, and the restock subscription J5's `stock-alerts` job
      already reads. The job exists; this gives it rows
- [ ] `src/lib/loyalty/ledger.ts` — balance is the sum of an append-only ledger, never a column kept
      in step by hand. Points earn on **delivery**, not on payment, so a returned order does not mint
      points; expiry and reversal are ledger rows
- [ ] `/account` shows the balance and the ledger behind it

**Close**
- [ ] OWASP pass: A01 every account surface scoped by session and traced to collection `access`,
      A02 no secret in a cookie the client can read, A04 eligibility decided server-side from the
      order, A07 no enumeration and a real lockout, A03 review bodies rendered as text
- [ ] `npm run check` green; `docs/ARCHITECTURE.md` §14 written

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

> Entries for closed stages J0–J5 live in `docs/SESSION-LOG.md`. Only the most recent
> sessions stay here — §0 needs to know where the last one stopped, not where every one did.

- 2026-07-28 [J7]: **Customer support complete.** `npm run check` green — 1426 unit tests (up from
  1359). `docs/ARCHITECTURE.md` §13 written and retitled from "Customer support and AI assistant",
  since the assistant is J11 and naming it here described work this stage did not do. No migration:
  `tickets` has carried its thread, assignment and timing columns since J1.
  **The security pass found a real hole, and it was in the layer the routes cannot protect.**
  `tickets.create` was `customerOrStaffCreate('support')`, which means Payload's own
  `POST /api/tickets` was open to any signed-in customer *whatever our routes did*. The
  `stampCustomer` hook fixed the owner and nothing else, so the rest of the body was theirs to
  choose: a ticket number that collides, a `firstResponseAt` that skews response-time reporting, and
  — the one that actually matters — an opening message with `authorType: 'agent'` and the author
  "Threadline Support". That is a fabricated quote from us, sitting inside a real thread, ready for
  a screenshot. Now `staffWrite('support')`, the same reasoning as `carts.create: denyAll` in J4,
  with staff keeping create so an agent can raise a ticket after a phone call. Four tests now call
  the collection's access functions directly, because the route tests would all have passed.
  This is the second stage running where the finding was at the collection layer rather than in the
  handlers — J4's A01 pass made the same point about `carts` and `orders`. Worth treating as the
  default question from now on: *what does Payload expose for this collection regardless of my
  routes?*
  **The design idea worth keeping: a reply's consequences are derived, not set.** `thread.ts` takes
  a message and returns the message *and its effect* — which status the ticket should move to, and
  whether this is the first agent reply. The naive version writes `pending_customer` in the agent
  endpoint and `open` in the customer endpoint, and within a month there is a path that forgets and
  a queue full of statuses describing nobody's reality. Same argument as deriving the notification
  from the status change in J6, and the same argument as the audit trail in J4.
  **Ownership, stated once**: a ticket number is not a credential. `findForActor` does the lookup
  *and* the check in one function, because a lookup plus a separate guard is precisely how a
  reference becomes a password. Another customer gets "not found" rather than "forbidden" — the
  latter confirms the reference is real — while staff without support permission get "forbidden",
  refused before the lookup where it reveals nothing. Two subtleties: the owner comparison is
  numeric, because `req.user.id` can arrive as a string while the relationship is an integer and
  `===` between those silently denies every customer their own ticket; and an order attached to a
  new request is dropped rather than refused when it is not theirs, since refusing would tell a
  prober which order ids exist.
  Order and ticket numbers now share `lib/utils/reference.ts`, second use per §3. Extracting it
  fixed a **latent bug**: the old parser captured any 2–6 letter prefix, so `TS-260728-0001` parsed
  as a perfectly valid *order* number. `isOrderNumber` would have said yes, and a support search
  would have gone looking in the wrong table and found nothing with no clue why. The parser now
  demands the prefix it was asked for.
  `ticket.replied` and `ticket.resolved` were the first events added since J6, and the exhaustiveness
  test caught the missing templates before anything ran — which is the honest answer to whether that
  dispatcher is reusable or merely looks it.
  `lib/auth/customerSession.ts` is new and small, and it is the seam J8 builds on: `customers` has
  been a real auth collection since J1, so a session already works; what J8 adds is the login *flow*
  around it. The account pages render a signed-out state rather than redirecting, because sending
  visitors to a login route that does not exist yet would be worse than telling them plainly.
  **Next: J8 — account, returns and loyalty**, with a static development OTP. Auth flow, order
  history with a status timeline, wishlist with the back-in-stock alerts J5 already sends, reviews
  with photos and fit feedback, returns and size exchange, loyalty points. Note this is the first
  stage since J1 that will **need a migration** — returns and reviews have collections already, but
  a full courier scan history (`shipmentEvents`, flagged in J5) and any new fields will not. Owner to
  run `npm run test:e2e` (still only proves J3) and `npm run build`.
- 2026-07-28 [J8, part 1 of n]: **Auth is built and walkable — the rest of J8 is not started.**
  `npm run check` green at 1455 unit tests (up from 1426). J8 is deliberately still `[ ]`; six of its
  boxes are ticked, everything under Returns, Reviews, Wishlist and Loyalty is untouched.
  Also this session, before J8: **J5, J6 and J7 all closed** (see `docs/SESSION-LOG.md` and the
  git log), and a `/doctor` pass cut this file from 77k characters to 30k by archiving closed-stage
  log entries, collapsing J0–J5, and dropping §3's directory tree. §0 gained the rule that keeps it
  that way. Auto mode is now the default permission mode and an unused plugin was disabled.
  **The J8 expansion confirmed there is no migration**, rather than assuming it: `returns`,
  `reviews`, `wishlists` and `loyaltyTransactions` all exist from J1, `customers` has been an auth
  collection since J1, and the development OTP is a fixed string with nothing to store. The J7 log
  predicted a migration would be needed here; that prediction was wrong and is corrected.
  **The decision worth keeping: the session is minted with Payload's own primitives.** A one-time
  code has no password and `payload.login()` wants one, so `auth/session.ts` calls `jwtSign`,
  `getFieldsToSign` and `generatePayloadCookie` (the last from `payload/shared` — it is exported at
  runtime from the root but missing from the root type surface). The alternative, a hand-rolled JWT,
  works the day it is written and then drifts: either into "nobody can log in", or — much worse —
  into a token this app accepts and Payload's own `auth()` does not agree about. Cookie flags,
  claims and the signing secret all come from the config rather than from this module.
  **Auth is the one surface where the shape of a refusal is the security property**, so the pure
  decisions in `login.ts` carry most of the tests. Requesting a code answers "if that address has an
  account, a code is on its way" whether or not it does, and does the same work either way — the
  friendly alternative turns the login form into a customer-list oracle. A wrong code and an expired
  code give one answer, because telling them apart says whether a guess is worth continuing. The
  lockout is checked when a code is *requested* as well as verified, or a script locked out of
  verifying simply asks for a new code; and locking out clears the outstanding code, so surviving a
  lockout is a reset rather than a resumption. An account is created only on successful
  verification, never on request, or probing addresses would populate `customers` for us.
  Two limitations written into `attemptStore.ts` rather than discovered later: attempt state is
  **per process** (so the effective ceiling is `MAX_OTP_ATTEMPTS × instances` — exact on one Railway
  container today) and **cleared on deploy**, which fails open. Both belong with the persistent
  hashed OTP at J11; the sweep deliberately never releases a live lockout early.
  `OTP_PROVIDER` documented in `.env.example`. The factory's production guard is the sharpest of the
  four now — a payment stub fabricates payments, but an auth stub hands every account in the shop to
  anyone who can type six zeroes.
  The account page renders `/account/orders` and `/account/wishlist` as "coming soon" rather than as
  links, because a door that 404s reads as a broken account. Flipping `ready: true` in `DOORS` is the
  whole of the change when each route lands.
  **Exact next action:** `/account/orders` and `/account/orders/[number]` — history and one order,
  scoped by session, with the timeline read from `orderEvents` (the audit trail every status change
  has written since J4, so the customer sees what the system recorded rather than a second story).
  The order number must authorise nothing, same rule as tickets: `payloadTickets.findForActor` is the
  pattern to copy. Then `src/lib/returns/`, which is the largest remaining piece and the one the
  engineering standards call first-class. Owner to run `npm run test:e2e` (still only proves J3) and
  `npm run build`; sign in locally at `/account` with any seeded customer's email and code `000000`,
  which the dev server prints to its console.
- 2026-07-28 [J8, part 2 of n]: **Order history and the returns logic. Still `[ ]`.** `npm run check`
  green at 1505 unit tests (up from 1455). Ticked: order history and its timeline, plus the three
  pure returns modules. Untouched: `payloadReturns.ts`, the returns API and customer flow, all of
  reviews, wishlist and loyalty.
  **The timeline reads `orderEvents`**, the append-only trail every status change has written since
  J4, rather than a story reassembled from `placedAt`/`deliveredAt` columns. One record read twice
  instead of two that drift. Which statuses a customer sees is the *same list*
  `statusNotification.ts` uses, and a test pins that agreement — if the two drift, the timeline and
  the emails tell different stories about one order, which is the kind of bug nobody reports.
  `orderEvents.note` is dropped on the way out: it carries provider event ids and staff shorthand.
  `accountOrders.find` matches the order number **and** the session's customer id in one query, so
  "not yours" and "no such order" are one answer. Guest orders are unreachable from an account on
  purpose — matching on email would hand every guest order to whoever later registers that address.
  **Returns: two decisions worth keeping.** Eligibility is **per line**, because three things bought
  and one going back is the ordinary case and an order-level yes/no forces three requests or none.
  And `checkReturnRequest` exists because a form can be edited: a quantity is input, not data, and a
  line id that is not on the order is *refused* rather than dropped — dropping it silently returns
  less than the customer asked for.
  **Exchange reserves the replacement at approval, not at shipping**, and that is the whole design.
  The tempting order — approve, collect, inspect, then look for a medium — is how a customer waits
  ten days to learn the size sold out on day two. The cost is a unit held that may never be claimed,
  which is worse for inventory and better for the customer; the alternative sells the same medium
  twice. `available` is `stockQty − reservedQty`, so an exchange cannot be promised against units
  held for somebody else's checkout.
  The status machine reaches money by exactly one route, `received → refunded`, and restores stock
  only at `received` — the same rule J5 stated when it refused to credit stock on a tracking event.
  Rejection stays reachable until the goods are with us, because parcels go missing.
  Applied §0's new archiving rule for the first time: J6's entry moved to `docs/SESSION-LOG.md` now
  that J7 has closed.
  **Exact next action:** `src/lib/returns/payloadReturns.ts` — raise · approve · receive · refund.
  Raise is customer-scoped (copy `accountOrders.find`'s single-query ownership check); the rest are
  `staffWrite('orders')`. Stock goes back through the ledger **only** on the transition to
  `received`, and an exchange takes its reservation at `approved` via
  `inventory/payloadReservation.ts`. Then `/api/returns` and the flow under
  `/account/orders/[number]`. Note `returns.access` needs the same audit `Tickets` got in J7 — check
  what Payload exposes for the collection before trusting the route. Owner to run `npm run test:e2e`
  and `npm run build`; sign in at `/account` with a seeded customer and code `000000`.
