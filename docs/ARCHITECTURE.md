# ARCHITECTURE.md

Technical reference, written progressively as stages complete.
Sections marked _pending_ are filled in when their stage lands.

---

## 1. Stack and pinned versions

Recorded at J0 (2026-07-26). Payload and Next versions must move together — check Payload's
supported Next range before upgrading either.

| Package | Version |
|---|---|
| next | 16.2.7 |
| react / react-dom | 19.2.6 |
| payload | 3.86.0 |
| @payloadcms/next · /ui · /db-postgres · /richtext-lexical | 3.86.0 |
| tailwindcss · @tailwindcss/postcss | 4.3.3 |
| typescript | 6.0.3 |
| vitest | 4.1.6 |
| @playwright/test | 1.59.1 |
| Node | ≥ 20.9.0 |

**Database:** PostgreSQL on Neon (development). AWS RDS in production.
The Postgres adapter pushes schema automatically in development; production uses generated
migrations.

## 2. Application layout

Two Next.js route groups, each with its own root layout, sharing one server:

- `src/app/(storefront)` — the public site. Imports `src/styles/globals.css`, so Tailwind and the
  design tokens apply here only.
- `src/app/(payload)` — the Payload admin, its REST API and GraphQL endpoint. Generated
  boilerplate; `admin/importMap.js` is regenerated with `npm run generate:importmap` whenever
  admin components change, and must never be hand-edited.
- `src/app/api` — application route handlers: `webhooks/`, `cron/`, `chat/`.

Business logic lives in `src/lib/` and is framework-agnostic. Components render; `lib/` decides.
Access rules live in `src/access/` and are shared across collections.

## 3. Design tokens

`src/styles/tokens.css` holds every colour, radius and motion value as CSS custom properties, with
light and dark values plus a `data-theme` override that beats the OS preference.
`src/styles/globals.css` maps them onto Tailwind's theme, so components use utilities
(`bg-surface`, `text-fg-muted`) and never raw hex.

**Rebranding is a four-line change:** the `--brand-*` values at the top of `tokens.css`.
Current accent is mulberry `#b04b76` (light) / `#e58ab0` (dark).

## 4. Money

`src/lib/pricing/money.ts` — an immutable value object over **integer paise**. Constructor rejects
fractional and unsafe values, so an invalid amount cannot exist. All price, tax, discount and total
arithmetic goes through it; rupee floats are never used for maths. `toJSON()` serialises to paise so
a database write cannot round-trip through a float. 24 unit tests in `tests/unit/money.spec.ts`.

## 5. Data model

22 collections and one global, defined in `src/collections/` (one file each) and listed once in
`src/collections/index.ts` — a file missing from that barrel does not exist as far as the database
is concerned. Field shapes that repeat (slug, money, SEO group, address snapshot) are built by
`src/collections/fields.ts` so that "money is integer paise" is a property of the system rather
than a habit. Full field reference: `docs/SCHEMA.md`.

Four modelling decisions carry the weight:

**Product vs variant.** A `product` is a *style* and does not sell; a `variant` is one size in one
colour, with its own SKU, price and stock, and is what a cart holds. A unique constraint on
`(product, size, colour)` guarantees exactly one row per cell of the matrix. SKUs are generated
`PRODUCT-COLOUR-SIZE` by a `beforeValidate` hook on create only — a SKU already printed on a
picking slip must not change under the warehouse.

**Snapshots, not joins.** `orderItems` copies the title, size label, colour name, unit price and
tax rate; `orders` copies the shipping and billing addresses. A product renamed or repriced next
month must not rewrite an invoice raised today.

**Append-only ledgers.** `stockMovements`, `orderEvents` and `loyaltyTransactions` deny `update`
and `delete` to every role including `super_admin`. A correction is a new row with a reason. This
is what makes a stock discrepancy explainable and a double-processed webhook detectable.

`variants.stockQty` is therefore never authored — it is the sum of the ledger, recomputed by
`syncVariantStock` (`src/lib/inventory/syncStock.ts`) after every movement. That function takes a
`StockLedgerPort` interface rather than Payload, so the hook, the seed and the tests all drive the
same maths through different storage. **The Payload implementation threads `req` into every nested
query** (`src/lib/inventory/payloadLedger.ts`): a hook runs inside the transaction creating the
movement, and a query that does not join that transaction cannot see the uncommitted row — it
sums an apparently empty ledger and writes `stockQty: 0` over good data.

**Config, not constants.** The `settings` global holds every number the owner might change —
free-shipping threshold, return window, GST state, loyalty rules. Publicly readable, because the
storefront needs them to render honest copy; nothing secret goes in it.

### Migrations and seeding

The Postgres adapter pushes schema automatically in development; production runs the generated
migration in `src/migrations/`. `npm run seed` builds a fictional demo catalog — 3 sellable
categories, 6 products, 76 variants across the full size × colour matrix, one staff account per
role and a demo customer. It is idempotent (matched on unique fields), refuses to run with
`NODE_ENV=production`, takes account passwords from `SEED_PASSWORD`, and reconciles every
variant against its ledger on the way out so a re-seed repairs drift rather than leaving it.

## 6. Access control and roles

Two auth collections: `users` (staff, carries a `role`) and `customers` (storefront, carries no
role at all). `admin.user` points at `users` only, so a storefront session cannot reach `/admin`
regardless of what its token claims. `users.role` is field-access locked to `super_admin` on
update — without that, any staff member editing their own row to change a password could promote
themselves.

The policy is data, not code: `src/access/permissions.ts` holds the role × resource matrix as a
single table, and every collection maps onto exactly one resource. `tests/unit/permissions.spec.ts`
asserts that table against the matrix transcribed from `docs/SCHEMA.md`, so widening a role in one
place and not the other fails the build.

`src/access/actor.ts` resolves who is calling — staff role, customer id, or neither — and treats
`isActive: false` as a hard deny, so a deactivated account keeps its row and loses every
permission. `src/access/index.ts` composes the two into Payload access functions.

The rule that matters most: **customer scoping returns a `Where`, not a post-filter.**
`ownScopedRead({ resource: 'orders', ownerField: 'customer' })` resolves to
`{ customer: { equals: <me> } }`, which Payload folds into the SQL. Another customer's row is
never fetched, so there is no forgotten filter downstream that could leak it. Scoping works across
a relationship too — order lines use `order.customer`. Staff read is asymmetric with staff write
on purpose: a `support_agent` may read every order and change none.

## 7. Admin tooling

Built at J2, aimed at one thing: an owner who is not a developer should be able to run the
catalog without asking anyone.

**Bulk variant generator.** Adding a shirt in 5 sizes and 3 colours is one action, not fifteen
rows typed by hand — which is where a real catalog acquires its missing sizes and its two
spellings of the same navy. `planVariantMatrix` (`src/lib/inventory/variantMatrix.ts`) decides
which cells of the matrix are missing and what each SKU is; the endpoint resolves ids and writes.
It is idempotent against what already exists, so the button is safe to press again after adding
one more colour, and it previews before it commits.

**Stock adjustment.** `stockQty` stays read-only everywhere, because it is derived. The owner
instead says what happened — "the count says 12", "40 arrived", "2 were damaged" — and
`src/lib/inventory/adjustment.ts` turns that into the signed movement that expresses it. A
no-op returns "already at that figure" rather than writing a zero-quantity row. This is what
lets the admin offer a plain "set stock to N" box without `stockQty` ever becoming writable.

**CSV import and export** (`src/lib/csv/`). Serialising is hand-written rather than taken from a
dependency because the requirement is small and the failure mode is expensive: a naive
`split(',')` corrupts exactly the rows a clothing catalog is full of — a fit note containing a
comma, a title containing a quote, care instructions containing a newline — and those are the
rows nobody notices are broken until the import has run.

Three decisions shape the import:

- **Dry run by default.** Committing takes an explicit `dryRun: false`. An import that repriced
  400 variants because a column was misread is not recoverable from the admin.
- **Every error at once**, with the spreadsheet line number and column. Someone fixing a file
  needs the whole list, not to fix one typo and rediscover the next.
- **Identity columns are not importable.** Product, category, size and colour are context for
  whoever reads the file; honouring them would silently rewrite the meaning of every order line
  already pointing at the variant. Stock is not written either — a changed figure becomes an
  `adjust` movement, so a CSV import lands in the ledger like every other stock change.

Money crosses the CSV boundary in **rupees**, not paise: a spreadsheet is a render boundary, and
an owner typing `1899.00` should not have to know the system counts in paise. `Money` does the
conversion, so the float never survives past parsing.

**Endpoints** live in `src/endpoints/`, mounted on their collections. Two properties are not
optional there. First, **a custom endpoint bypasses collection access entirely** — Payload only
applies those to its own CRUD routes — so every handler re-checks the role through
`requireWrite` (OWASP A01). Second, every handler is wrapped in `safeHandler`, which turns an
unanticipated throw into a plain 500: without it a database error returns the failing SQL, its
parameters and a stack trace to the caller, which is a free map of the schema (OWASP A05).
Expected failures are still the handler's own 400s, with messages written for a human.

**Role-aware navigation.** `src/access/adminUI.ts` hides a collection from the sidebar unless the
role can read it, bound centrally in `src/collections/index.ts` rather than repeated 22 times.
Hiding is never the control — `src/access/` has already refused the request; this only stops the
admin offering a door that is locked. A test asserts the two agree for every role and resource,
because a nav that disagrees with the access rules produces either a link that 403s or a hidden
page a role can actually use.

**Dashboard counters** replace a dashboard that only says hello with the four numbers that mean
somebody has to do something today: low stock, orders awaiting action, open tickets, reviews
awaiting moderation. A Server Component, gated on the same matrix, so a `marketing` user sees the
catalog and order counts and nothing about support.

## 8. Payments — Razorpay

_pending (J4)_

## 9. Shipping — Shiprocket

_pending (J5)_

## 10. Scheduler

_pending (J5)_

## 11. Notifications — email and WhatsApp

_pending (J6)_

## 12. Customer support and AI assistant

_pending (J7)_

## 13. SEO

_pending (J9)_

## 14. Deployment

_pending (J10)_

---

## Testing

| Command | What it runs |
|---|---|
| `npm run check` | typecheck → lint → unit tests. The gate for every stage |
| `npm test` | Vitest: `tests/unit/**/*.spec.ts` and colocated `src/**/*.test.ts` |
| `npm run test:e2e` | Playwright against a dev server it starts itself |

`tests/helpers/` holds e2e login and user-seeding helpers. Playwright selectors that target Payload
admin internals (`.dashboard`) are version-sensitive — expect to revisit them after a Payload upgrade.

## Changelog

- **2026-07-27 (J2)** — Admin usability. Bulk variant generator, stock adjustment through the
  ledger, catalog CSV import/export with dry-run, role-aware nav, dashboard counters. Endpoints
  gained a shared role guard and error boundary. 351 unit tests.
- **2026-07-27 (J1)** — Data model. 22 collections and the `settings` global; `src/access/` with the
  role matrix as testable data; stock as an append-only ledger with a recomputed cache; migration
  `20260726_181320_j1_data_model`; idempotent demo seed. 214 unit tests.
- **2026-07-26 (J0)** — Foundation. Next 16 + Payload 3.86 + Neon Postgres, route groups, folder
  structure, design tokens, `Money`, Vitest and Playwright harnesses, OWASP baseline documented.
