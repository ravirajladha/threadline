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

## 8. Storefront browse — catalog and SEO

Built at J3. Four public routes — `/`, `/shop`, `/c/[slug]`, `/p/[slug]` — over a catalog layer in
`src/lib/catalog/` that the App Router only ever renders the output of. No page fetches from
Payload directly, and no component decides what is in stock.

**The port is the contract.** `src/lib/catalog/types.ts` defines `CatalogPort` — the shape of
everything a storefront page can ask for — and every other module in the folder is written against
it. `payloadCatalog.ts` is the only implementation that knows Payload exists, and `server.ts`
wraps it in React's `cache` so one request resolves it once. The rest of the folder is pure
functions over plain data, which is why the whole browse experience is unit-testable without a
database and why J9 can replace the read strategy without touching a page.

**Filters are a URL, not a state object.** `filters.ts` parses search params into a typed
`CatalogFilters` and serialises it back. Two properties matter. The input is hostile — a query
string is whatever someone pasted — so an unparseable page number, an unknown sort key or a
negative price is **dropped, never thrown on**; a filter rail that 500s on a mangled link is worse
than one that ignores it. And serialisation is **canonical**: keys in a fixed order, defaults
omitted, values sorted. One filter set therefore has exactly one URL, which is what makes a
filtered listing shareable, cacheable and safe to declare as its own canonical.

**Facets constrain a variant, not a product.** This is the decision the rest of `select.ts` falls
out of. "M" plus "blue" has to mean *a blue M exists* — not that the product has an M somewhere
and a blue somewhere. So the facets run over the variant list and a product survives only if
something is left of it. Getting this wrong is the difference between a filter that works and one
that confidently offers a shirt in a combination nobody can buy.

**A facet is never counted against itself.** Each facet's counts are computed with that facet's own
selections lifted, and every other filter still applied. Without it, ticking "Navy" makes every
other colour read zero and the rail becomes a dead end — the familiar broken filter that can only
ever be narrowed. `computeFacets` does this once per request rather than per checkbox.

**One catalog read, not a query per facet.** `loadCatalogIndex` pulls the active catalog once and
`select.ts` filters, facets, sorts and paginates it in memory. This is a deliberate trade, not an
oversight: a variant's price falls back to its product's MRP when it does not override it, and SQL
cannot order by a value that is defined by that fallback without a join and a coalesce per row —
so pushing sort down to the database would mean modelling the fallback twice, in two languages,
and keeping them in agreement. In-memory selection has one source of truth for price and a
ceiling; `loadCatalogIndex` is the single seam where J9 replaces it once the catalog outgrows it.

**View models flatten depth.** `variantView.ts` and `productView.ts` turn depth-populated Payload
documents into flat, serialisable views a Server Component can hand to a client one. Availability
is `stockQty − reservedQty` floored at zero, computed **server-side, every time** — never read
from a query string and never trusted from the client (OWASP A04). A sold-out size arrives as a
pill with `isAvailable: false`, because it is rendered visible and struck through rather than
hidden: a customer who cannot find their size assumes the shop does not stock it, and a customer
who can see it sold out is someone to notify when it returns.

**Metadata and structured data are builders, not decoration.** `seo/metadata.ts` composes Next's
`Metadata` from a document plus its own `seo` override, and a filtered listing **canonicalises to
the clean category URL** — every combination of facets is one page's worth of duplicate content
otherwise. `seo/jsonLd.ts` builds Product, BreadcrumbList, WebSite and Organization objects.

`escapeJsonLd` is the security boundary and the reason `components/seo/JsonLd.tsx` is the only
component in the storefront allowed to use `dangerouslySetInnerHTML`. Inside a `<script>` the HTML
parser is not reading JSON — it is watching for the string `</script`, and it ends the element the
moment it sees one. A product title containing `</script><img src=x onerror=…>` would otherwise
break out of the data block and execute, which is stored XSS (OWASP A03). Escaping `<`, `>` and
`&` to their `\uXXXX` forms is valid inside a JSON string, so consumers parse the same object.

**Security headers** land in `next.config.ts` at this stage, because J3 is the first that serves a
public page: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors` (OWASP
A05). Slug routes resolve only `active` products, so a draft or archived garment is a 404 rather
than a page reachable by anyone who guesses the URL.

**Components hold no business logic.** `ListingView` composes the rail, sort, active-filter chips,
grid and pagination; every one of them is handed data and a callback. Interactivity is confined
to four `"use client"` components, and each of them derives what it shows during render rather
than synchronising it in an effect — the gallery tracks the chosen *image id*, not its index, so a
colour change stops matching and resets on its own; the variant picker keeps the customer's
explicit size and resolves the effective one against the current pill set. Effects that copy
props into state are the standard source of the cascading second render, and none survive here.

## 9. Payments — Razorpay

_pending (J4 stub, J11 live)_

## 10. Shipping — Shiprocket

_pending (J5 stub, J11 live)_

## 11. Scheduler

_pending (J5)_

## 12. Notifications — email and WhatsApp

_pending (J6 stub, J11 live)_

## 13. Customer support and AI assistant

_pending (J7 tickets, J11 assistant)_

## 14. SEO — sitemap, OG images and Core Web Vitals

_pending (J9). The metadata and structured-data builders are §8._

## 15. Deployment

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

- **2026-07-27 (J3)** — Storefront browse. `src/lib/catalog/` behind a `CatalogPort` interface —
  URL-canonical filters, variant-level faceting, in-memory selection over one cached catalog read;
  `src/lib/seo/` metadata and JSON-LD builders with boundary escaping; security headers and CSP;
  the four public routes and their components. Seed imagery made non-fatal and account creation
  moved ahead of it. 746 unit tests.
- **2026-07-27 (J2)** — Admin usability. Bulk variant generator, stock adjustment through the
  ledger, catalog CSV import/export with dry-run, role-aware nav, dashboard counters. Endpoints
  gained a shared role guard and error boundary. 351 unit tests.
- **2026-07-27 (J1)** — Data model. 22 collections and the `settings` global; `src/access/` with the
  role matrix as testable data; stock as an append-only ledger with a recomputed cache; migration
  `20260726_181320_j1_data_model`; idempotent demo seed. 214 unit tests.
- **2026-07-26 (J0)** — Foundation. Next 16 + Payload 3.86 + Neon Postgres, route groups, folder
  structure, design tokens, `Money`, Vitest and Playwright harnesses, OWASP baseline documented.
