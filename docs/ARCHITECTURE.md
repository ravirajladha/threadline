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

## 9. Cart, checkout and orders

Built at J4. Routes `/cart`, `/checkout`, `/checkout/pay`, `/checkout/success`, `/checkout/failed`
over four API handlers — `/api/cart`, `/api/checkout`, `/api/webhooks/payments` and the
development-only `/api/payments/simulate`. Payment is a `StubGateway`; the signature verification,
the idempotency and the order status machine around it are real (CLAUDE.md §2).

**The server is the only authority on money.** `src/lib/pricing/` is pure and takes no dependency on
Payload. `totals.ts` composes subtotal, shipping, tax, discount and loyalty and then **asserts its
own invariant** — the parts must sum to the grand total to the paise, or it throws
`TotalsMismatchError` and no order is written. A failed checkout is recoverable; an order charged
against totals that do not reconcile is found weeks later by whoever is doing the books.

**GST is split floor + remainder, never two roundings.** Halving the tax and rounding each half
independently produces a pair that does not add up to the whole. So `tax.ts` computes one half by
`Math.floor` and takes the other as the remainder, making `cgst + sgst === tax` true by
construction. Jurisdiction is decided first — CGST+SGST within the state, IGST across it, **never
both** — and the split is computed on the delivery address the customer actually entered, which is
why `/api/checkout` re-prices rather than trusting the figures the checkout page was showing.

**A refused coupon returns a reason, not a boolean.** `coupon.ts` answers with either a discount or
one of a typed set of rejections — inactive, not started, expired, min cart, total limit, per-user
limit, no eligible items. The cart renders it as something the customer can act on ("spend ₹400
more"), which a `false` cannot express. Nothing about a coupon is decided in a component.

**The cart lives in the database, keyed by an opaque session cookie.** No id in any request body
names a cart, so asking for somebody else's is not expressible rather than merely refused
(OWASP A01). `cartView.ts` **re-prices every line from its variant on every read** and flags a
price that moved since it was added rather than silently charging the new one; `priceAtAdd` is kept
to explain a difference, never to total with. Reading does not mint a session — a crawler would
otherwise leave a `carts` row per page view — but a mutation may, because that is what "add to bag"
means for a first-time visitor.

**Stock is held before payment, in one statement.** `reservation.ts` is the pure plan — lines plus
availability in, reservations or the shortages that block them out. `payloadReservation.ts` applies
it, and this is where the oversell guarantee actually lives:

```sql
UPDATE variants SET reserved_qty = reserved_qty + $qty
 WHERE id = $id AND stock_qty - reserved_qty >= $qty
```

Check and take are the same statement, so **zero rows updated is the shortage** — there is no
separate read to fall out of step with the write. `placeOrder` holds stock *before* the order row
exists, so a shortage leaves nothing to undo and the customer keeps their cart.

**Only a signature-verified webhook may mark an order paid.** `/api/checkout` creates a prepaid
order `pending` and never settles it; the browser is never believed about payment. The webhook
verifies the **raw body bytes** before parsing — `JSON.parse` → `JSON.stringify` does not reproduce
what was signed — compares digests in constant time, and answers every rejection with the same
"invalid", because distinguishing a bad signature from an unknown order is free reconnaissance.

**Idempotency by event id, ordered by a row lock.** Providers retry, so the same capture arriving
twice is ordinary traffic. Processed event ids are recovered from the append-only `orderEvents`
trail rather than a second table that could disagree with it. That check is only sound if the two
deliveries are ordered: under Postgres's default READ COMMITTED, two concurrent applies would both
read a trail without the event id and both read `paymentStatus: 'pending'`, so neither the
duplicate-event guard nor the already-paid guard would fire — confirming the order twice and
selling the stock twice. `applyPaymentEvent` and `transition` therefore take
`SELECT … FOR UPDATE` on the order row **before reading anything**, and `transition` opens a
transaction when it was not given one, since a lock outside a transaction is released at once.

**An order number never authorises reading an order.** It is a date plus a small sequence, so a page
that trusted `?order=` would hand out strangers' addresses to anyone counting upwards. The
confirmation pages read an httpOnly `tl_order` cookie and never the URL. `SameSite=Lax`
deliberately: `Strict` is withheld on the cross-site return from a payment gateway, so the
confirmation page would come up blank for exactly the customers who paid.

**Raw SQL exists in two places and both are about concurrency** — the conditional stock update
above, and the order row lock. Both go through `lib/utils/drizzle.ts`, which resolves the client for
the *open transaction* (Payload keeps one session per transaction id; the pooled client would run
outside it and release a lock immediately). Every value crosses as a bound parameter; a test asserts
the order number appears in the lock statement's parameters and **not** in its text (OWASP A03).

**Stubs cannot reach production.** `payments/factory.ts` selects by environment and throws at
startup if production has no real gateway configured. `/api/payments/simulate` additionally refuses
unless the gateway really is a `StubGateway`, and answers 404 rather than 403 — a route that admits
to existing tells an attacker what to look for. It does **not** call `applyPaymentEvent`: it signs a
body for real and hands it to the webhook route, so the local happy path runs *over* verification
instead of around it, and J11 changes only who makes the request.

**Rate limiting is a sliding window**, not a fixed one: a fixed window lets a caller spend one
allowance at 0:59 and the next at 1:01, double the intended rate across exactly the boundary a
script will find. The clock is injected, so that case is a test rather than a sleep. Coupon apply
gets the tightest allowance, since an unlimited one is an oracle for guessing codes.

**The caller is identified from the right of `x-forwarded-for`, not the left.** That header is a list
each proxy appends to, so the left-most entry is simply whatever the client sent — taking it meant a
script could put a fresh value there on every request and collect a fresh allowance each time, which
defeated the coupon limit entirely. `clientIpFrom` counts `TRUSTED_PROXY_HOPS` entries from the end
instead, landing on the entry appended by the proxy nearest us: Railway's edge appends the true peer
address after anything supplied, so with one trusted hop prepended junk only pushes itself further
away. The count is configuration because it is a fact about the deployment — too low leaves the
bypass open, too high buckets every visitor behind one edge node together. An unattributable caller
falls into a single shared `unknown` bucket rather than being granted a private one, which is
deliberately the aggressive direction: a forged header earns a worse allowance than an honest one.

## 10. Fulfilment and shipping

Built entirely against `StubShippingProvider` (CLAUDE.md §2). The parts that must be right when a
real courier arrives — signature verification, idempotency by event id, the status machine and the
row lock around it — are built for real now and tested against the stub's payloads. No migration:
`orders` already carried `awbCode`, `courier` and `shiprocketOrderId` from J1, and `orderEvents` is
already the audit trail.

**The interface is shaped around what has to be trusted.** `createShipment` may be fabricated by a
stub; `verifyWebhook` is the security boundary, because a tracking callback is how an order becomes
`delivered` — which closes it, stops the customer being chased and starts the return window. The
stub's `simulateTracking`, `nextCourierStatus` and `currentCourierStatus` are on the class and
deliberately **off** the interface: a real courier has none of them, so nothing in fulfilment can
come to depend on being able to advance a parcel by asking.

**A courier status maps to one of three answers, never to a nullable status.** `{ kind: 'status' }`,
`{ kind: 'no_change' }` and `{ kind: 'unknown' }` are different facts: "PICKUP SCHEDULED" is
recognised and moves nothing, while an unrecognised code means the provider's vocabulary has drifted
and `statusMap` needs a row. Collapsing both into `null` is how tracking silently stops working. The
case this exists for is `UNDELIVERED` — a substring fallback ("contains 'deliver'") would mark an
undelivered parcel delivered, so there is no fallback at all and a test pins it.

**`trackingApply.ts` checks identity before meaning.** Wrong order, then wrong parcel, then
duplicate, then what the status means — so a courier reporting a stranger's AWB against our order
number cannot mark it delivered. A scan the order cannot act on is an *ignore* with one of six typed
reasons, never a throw: a 500 to a courier buys nothing but a retry storm. A scan arriving before our
own booking write is accepted, since refusing it would strand the order at `packed` for ever.

**Idempotency reuses the audit trail.** `orders/eventTrail.ts` recovers provider event ids from
`orderEvents.note`, with the id prefixes as a *parameter* — payments and tracking must not see each
other's ids, and a test asserts each integration is blind to the other's. Tokenising the note beats a
regex: an alternation over prefixes has to be ordered longest-first or `evt_` matches inside
`stub_evt_1`. `orderEvents.toStatus` is required, so an informational scan cannot be recorded without
inventing a transition that never happened — and does not need to be, since applying a no-op scan
twice does nothing twice. The trail therefore holds status changes, not every courier scan; a full
scan history for the customer timeline would be a `shipmentEvents` collection and a migration, at J8.

**Nothing writes `orders.status` directly.** `payloadShipping` and `payloadFulfilment` both call
`payloadOrders.transition`, which validates the jump, inherits J4's `SELECT … FOR UPDATE` and writes
the `orderEvents` row. `bookShipment` locks before reading the AWB, so a double-clicked button
returns the existing parcel rather than booking — and paying for — a second one. Deliberately no
stock movement on delivery or RTO: stock was committed at capture, and units come back only through
J8's returns flow, after the goods are inspected.

**Fulfilment is a decision, not a condition in a component.** `orders/fulfilment.ts` asks the status
machine rather than restating it, and adds only what a transition cannot express — no shipping
without an AWB, no packing a prepaid order that has not been paid for. Refusals are ordered so the
most fundamental reason wins: a cancelled order reports `illegal_transition`, not "book a courier
first", which would read as an instruction. A test walks every `ORDER_STATUSES` value against
`canTransition` to prove this file can only ever be stricter than the graph.

`orders/payloadFulfilment.ts` is the staff-facing port. It re-checks the role **before the order is
read**, so a caller who may not fulfil orders cannot learn from the difference between "forbidden"
and "not found" whether an id exists (A01/A07); it re-reads state under the row lock rather than
trusting the admin screen's snapshot (A04); and it takes the shipping port as a *thunk*, because
resolving a courier throws when production has none configured and packing an order does not involve
one. The admin panel renders `fulfilmentOptions` — the same function — so an enabled button and a
server refusal cannot disagree, and a refused action is shown disabled with its reason.

## 11. Scheduler

**One registry, one runner, one route.** `registry.ts` throws at module load on a duplicate job name
— two jobs under one name otherwise surfaces as one of them silently never running — and on a
`JobName` with no implementation. Lookup by name is the only way `/api/cron/[job]` can reach a
handler, so a URL segment cannot select arbitrary code: `findJob` narrows against a closed union
first, and the worst an unknown name does is return null.

`runner.ts` turns a throw into a failed `JobResult` and a hang into a failure after a timeout, and
measures the duration. Stated honestly: **a timeout abandons a job, it does not cancel it** — JS
cannot interrupt a running promise — so every job must be safe to have run twice.

**A job reports counts, not prose.** `{ examined: 120, notified: 3, too_recent: 117 }` makes a run
auditable from the response alone; a job that returns "ok" is one nobody notices has stopped doing
anything. Each job is a pure decision over *who qualifies* plus a thin port, so the rules are tested
without a database — which matters because a cron firing hourly turns a wrong rule into an hourly
wrong rule.

| Job | Qualifies | Idempotency |
|---|---|---|
| `abandoned-cart` | has items, has an address to write to, idle ≥ 6h, ≤ 72h old | `carts.abandonedNotifiedAt` |
| `status-sync` | in a courier's hands, has an AWB, no movement for 48h | none needed — it only reports |
| `stock-alerts` | subscribed, `stockQty − reservedQty` > 0 | notification subject `restock:<customer>:<sku>` |
| `review-requests` | delivered, 5–30 days ago | notification subject `order:<orderNumber>` |

**`status-sync` does not poll the courier**, and that is deliberate: `ShippingProvider` has no
tracking fetch because a webhook-only courier cannot answer one. It does the thing a webhook cannot
do for itself — notice *silence*. A missed webhook has no failure signature; the order simply sits at
`shipped` for ever. An in-flight parcel with no history at all is reported as stale rather than as
fine, because that is a bug rather than a quiet week.

**Idempotency comes from the notification log, not a second table** (`lib/notify/queue.ts`) — the
same argument as `eventTrail.ts`. A `subject` string identifies the *occasion* a message is about and
is matched exactly, never by prefix. Consequence worth knowing: a variant that goes in and out of
stock repeatedly produces one alert, not five. That is the intended trade.

**Cron authentication is the whole of the authorisation.** A job runs with no user and full
authority. `CRON_SECRET` is compared in constant time over a SHA-256 digest, so the comparison cannot
leak the secret's length, and an *unset* secret refuses every request rather than allowing them — the
"skip the check if it is not configured" shortcut is how a missing environment variable becomes an
open endpoint. A wrong secret and an unknown job name both answer **404, never 401** (CLAUDE.md §2),
so the route confirms neither that it exists nor which jobs do.

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

- **2026-07-27 (J5)** — Orders, fulfilment and the scheduler, against `StubShippingProvider`.
  `src/lib/shipping/` with the provider contract, the courier status table, tracking application and
  the Payload port; `orders/fulfilment.ts` and `payloadFulfilment.ts`; one job registry, runner and
  four jobs; `/api/webhooks/shipping`, `/api/shipping/simulate` and `/api/cron/[job]`; fulfilment
  actions on the admin order view. No migration. 1308 unit tests.
- **2026-07-27 (J4)** — Cart, checkout and orders, against `StubGateway`. Pricing, cart, stock
  reservation, the order status machine and the payment webhook; the row lock that made
  `applyPaymentEvent` safe under READ COMMITTED. 1108 unit tests.
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
