# Session log — archive

Closed-stage entries, moved out of `CLAUDE.md` on 2026-07-28 so the journey file stops paying for
finished work in every session. Nothing here was rewritten; the entries are verbatim.

`CLAUDE.md` §8 keeps only the most recent entries, which is what its own §0 actually needs — "log
exactly where you stopped" is a question about the *last* session. Read this file when you want the
reasoning behind a stage that is already `[x]`; `docs/ARCHITECTURE.md` §5–§13 carries the same
ground as durable prose rather than as history.

---

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
- 2026-07-27 [J5, part 1 of n]: **Stage expanded and the shipping contract built — no ports, no
  routes, no scheduler yet.** `npm run check` green at 1176 unit tests (up from 1108). J5 is
  deliberately still `[ ]`.
  Expanded J5 with its task list first, per §0. Confirmed while doing so that **no migration is
  needed**: `orders` already carries `awbCode`, `courier` and `shiprocketOrderId` from J1, and
  `orderEvents` is already the audit trail, so nothing in this stage touches the schema.
  Shipped: `shipping/types.ts`, `statusMap.ts`, `stubProvider.ts`, `factory.ts` and
  `orders/fulfilment.ts`, all pure or stub, all unit-tested.
  Two design decisions worth keeping. **A courier status maps to one of three answers, not to a
  nullable status.** `{ kind: 'status' }`, `{ kind: 'no_change' }` and `{ kind: 'unknown' }` are
  genuinely different facts: "PICKUP SCHEDULED" is recognised and moves nothing, while "TELEPORTED"
  means the integration has drifted and somebody should hear about it. Collapsing both into `null`
  is how tracking silently stops working after a provider renames a code. The case this exists for
  is `UNDELIVERED` — the obvious substring fallback ("contains 'deliver'") would mark an undelivered
  parcel delivered, closing the order and stopping the customer being chased, so there is no
  fallback at all and a test pins it.
  And **`fulfilment.ts` asks the status machine rather than restating it.** It only adds the
  conditions a transition cannot express — no shipping without an AWB, no packing a prepaid order
  that has not been paid for — and refusals are ordered so the *most fundamental* reason wins: a
  cancelled order reports `illegal_transition`, not "book a courier first", because the latter reads
  as an instruction. A test walks every `ORDER_STATUSES` value against `canTransition` to prove this
  file can only ever be stricter than the graph, never more permissive; that is the guard against
  the two drifting apart.
  Also caught in passing: I had copy-pasted the status normaliser into `stubProvider.ts` as
  `normaliseForSequence`, identical to `statusMap`'s. Deleted, now imported — §3 forbids exactly
  that. The stub's tracking sequence uses the **real** Shiprocket status strings, and a test asserts
  every one of them is a status `statusMap` understands, so the local flow cannot be driven by
  tokens the real mapper would reject.
  `.env.example` documents `SHIPPING_PROVIDER` and `SHIPPING_WEBHOOK_SECRET`; the factory reads
  both, and neither existed before.
  **Exact next action:** write `src/lib/shipping/payloadShipping.ts` — attach an AWB to an order and
  apply a tracking event idempotently by event id, reusing `payloadOrders.transition` (and therefore
  its row lock) rather than writing `status` directly. The idempotency check has the same shape as
  `applyPaymentEvent`'s and should read the event id out of the `orderEvents` trail the same way;
  note that `processedEventIdsFrom` in `paymentApply.ts` matches on `evt_`/`stub_evt_` prefixes and
  will **not** match a `stub_trk_` tracking id, so that helper needs a parameter rather than a
  second copy. Then `orders/payloadFulfilment.ts`, then the three routes.
- 2026-07-27 [CI]: **The billing lock is cleared and CI is green.** Owner added a payment method;
  run 30275575121 completed in 1m9s with `conclusion: success`, every step executed on a hosted
  runner, including `Typecheck, lint and test`. So the 1176 unit tests are now verified off this
  machine as well as on it. Supersedes the note in the J4 entry above telling the next session to go
  and clear it — nothing to do. Worth remembering the tell rather than the incident: a CI failure at
  3s with `"steps": []` never ran, so read the check-run annotations API, not the (nonexistent) log.
- 2026-07-27 [A07 fix]: **The rate-limiter bypass is closed.** `npm run check` green at 1200 unit
  tests (up from 1176). Owner answered the `docs/FEATURES.md` question: nothing sits in front of
  Railway — no custom domain, and Cloudflare is R2 media storage only, not a proxy — so the trusted
  hop count is **1**.
  `clientKey` took the left-most `x-forwarded-for` entry, which is whatever the caller sent, so a
  script rotating that header collected a fresh allowance per request and the coupon-apply limit —
  whose only purpose is to stop code guessing — was bypassable. `clientIpFrom` now counts
  `TRUSTED_PROXY_HOPS` entries from the **right**, landing on the address Railway's edge appended,
  which is the last entry an outsider cannot forge: prepended junk only pushes itself further from
  the end. A test asserts three different forged headers all land in the *same* bucket, which is the
  property that actually matters.
  Three deliberate choices. `x-real-ip` was dropped as a fallback rather than kept — it is equally
  client-settable, so an attacker could simply omit `x-forwarded-for` and rotate that instead, and a
  fallback chain is what reintroduced the hole. An entry that is not a plausible IP resolves to a
  single shared `unknown` bucket, never to a neighbouring entry, so being unattributable earns a
  *worse* allowance than being honest. And a malformed `TRUSTED_PROXY_HOPS` falls back to the default
  rather than to zero, because reading `one` as "trust nothing" would collapse every visitor into one
  bucket — an outage from a typo in an env var.
  `TRUSTED_PROXY_HOPS` documented in `.env.example` with what each value means and how each direction
  fails; `ARCHITECTURE.md` §9's rate-limiting paragraph rewritten, since it documented the old
  behaviour as a known limitation. `trustedProxyHops` takes the raw string rather than an environment
  object — a test that has to build an env bag to exercise a parser is testing the bag, and typing it
  as a partial `ProcessEnv` tripped TypeScript's weak-type check anyway.
  Nothing to set on Railway: 1 is the default, so the deployment is already correct.
- 2026-07-27 [J5, part 2]: **Tracking works end to end at the library level.** `npm run check` green at
  1226 unit tests (up from 1200). Shipped `shipping/trackingApply.ts`, `shipping/payloadShipping.ts`
  and `orders/eventTrail.ts`. Still `[ ]` — no routes, no scheduler, no admin actions.
  The blocker flagged last session was real: `processedEventIdsFrom` matched only `evt_`/`stub_evt_`,
  so every replayed *delivery* scan would have looked new and a duplicate "DELIVERED" would have been
  applied twice. Rather than a second copy of the scraper, the prefixes became a parameter and the
  function moved to `orders/eventTrail.ts` — a file neither integration owns (§3, second use).
  `paymentApply.processedEventIdsFrom` is now a named wrapper bound to the payment prefixes, kept so a
  caller cannot ask for "payment ids" and silently receive tracking ids too. A test asserts each
  integration is blind to the other's ids, which is the bug restated as a guard.
  Tokenising the note beats a regex here: an alternation over prefixes has to be ordered longest-first
  or `evt_` matches *inside* `stub_evt_1` and yields a different id. That is a trap for whoever adds
  the third prefix, not a property of the code, so splitting on whitespace and comparing prefixes is
  the version that stays correct.
  **`orderEvents.toStatus` is `required: true`, and that shaped the design for the better.** An
  informational scan has no target status, so it cannot be recorded without inventing a transition
  that never happened. It turns out it does not need to be: the only side-effecting path is a status
  change, whose id `transition` already writes into its note, and applying a no-op scan twice does
  nothing twice. So idempotency falls out for free and J5 still needs no migration. The cost is that
  the trail holds status changes rather than every courier scan — if a full scan history is wanted for
  the customer timeline, that is a `shipmentEvents` collection and a migration, at J8.
  Design notes worth keeping. **A scan the order cannot act on is an ignore, never a throw** — six
  typed reasons, and only `unknown_status` is worth a warning, because everything else is ordinary
  courier noise while an unrecognised string means the provider's vocabulary moved and `statusMap`
  needs a row. **Identity is checked before meaning**: wrong order, then wrong parcel, then duplicate,
  then what the status means — so a courier reporting a stranger's AWB against our order number cannot
  mark it delivered. And a scan arriving *before* our own booking write is accepted, since refusing it
  would strand the order at `packed` for ever.
  `payloadShipping` never writes `orders.status` itself; it calls `payloadOrders.transition`, which
  inherits J4's row lock and guarantees the audit row. `bookShipment` locks before reading the AWB, so
  a double-clicked button returns the existing parcel instead of booking — and paying for — a second
  one. Deliberately no stock movement on delivery or RTO: stock was committed at capture, and units
  come back only through J8's returns flow, after the goods are inspected.
  **Exact next action:** `orders/payloadFulfilment.ts` (pack and ship, re-checking the role, driven by
  `fulfilment.ts`), then the three routes — `/api/webhooks/shipping`, `/api/shipping/simulate` and
  `/api/cron/[job]`. The scheduler (`lib/scheduler/`) is untouched and is the larger half of what is
  left in J5. Note `Variants.weightGrams` is often unset in seed data, so `parcelWeightFor` falls back
  to 300g per item — fine for the stub, worth filling in before a real courier quotes on it.
- 2026-07-27 [J5, closed]: **Stage complete.** `npm run check` green — typecheck, lint and 1308 unit
  tests (up from 1226). `docs/ARCHITECTURE.md` §10 and §11 written; §10 retitled "Fulfilment and
  shipping", since "Shipping — Shiprocket" named a provider this stage deliberately does not use.
  Shipped: `orders/payloadFulfilment.ts`, the whole of `lib/scheduler/` (types, registry, runner and
  four jobs), `lib/notify/queue.ts`, `lib/http/cronAuth.ts`, the three routes, and the fulfilment
  panel plus its two endpoints on the admin order view. No migration — confirmed again at the end,
  not assumed at the start.
  **The stage's one open design question was idempotency, and it shaped everything.** A cron that
  fires hourly must not send an hourly email, and only one of the four jobs had a marker field
  (`carts.abandonedNotifiedAt`). The obvious answer was two new columns and a migration. The one
  taken instead was J4's: the record of what we sent **is** the notification row, so ask it — a
  `subject` string identifying the *occasion* (`order:260720-0003`, `restock:5:TL-SHIRT-NAVY-M`),
  matched exactly and never by prefix, narrowed in SQL by the indexed `event` and `recipient`. One
  record rather than two that can disagree, and J5 stays migration-free. The cost is stated in the
  architecture: a variant that goes in and out of stock five times produces one alert, not five.
  **`status-sync` does not poll the courier, and refusing to was the right call.** The obvious
  reading of the job name is "ask Shiprocket what happened". But last session put
  `simulateTracking` and `nextCourierStatus` on the stub *class* and deliberately off the
  `ShippingProvider` interface, precisely so nothing could come to depend on advancing a parcel by
  asking — a webhook-only courier cannot answer. Adding a `fetchTracking` method would have quietly
  reversed that. So the job does the thing a webhook cannot do for itself: it notices **silence**. A
  missed webhook has no failure signature — no error, no retry, nothing in a log — the order just
  sits at `shipped` for ever. An in-flight parcel with no history at all is reported as stale rather
  than as fine, because that is a bug, not a quiet week.
  Two defects found by writing the tests rather than by reading the code. **`createPayloadFulfilment`
  took the shipping port eagerly**, so the endpoint built a courier to *pack* an order — and the
  factory throws when production has no real provider configured, which would have made packing fail
  for want of a courier it never uses. Now a thunk, with a test asserting `perform` never resolves
  one. And **`/api/shipping/simulate` answered 500 rather than 404 outside development**: the
  factory's throw propagated to `safeRoute`, and a 500 is an admission that the route exists. Caught
  now, so every non-development answer is the same 404.
  On testing the lock honestly, per the J4 precedent: the concurrency assertions were **seen to
  fail** before being trusted. Neutralising `lockOrderById` in `perform` fails two tests — and the
  second failure mode is worth recording, because it is what the lock actually buys: without it the
  losing flow *throws* out of `assertTransition` instead of returning a typed refusal, so a
  double-clicked button would have shown staff a 500 rather than "this order is already packed".
  The lock-aware Payload double moved out of `payloadOrders.spec.ts` into `tests/unit/support/` on
  its second use, per §3, and gained a logger recorder so an audit-line claim can be asserted rather
  than assumed — the denial test now proves the warning does not name the order it refused.
  OWASP pass run against the code. **A01** holds twice over: `requireWrite` on each endpoint *and*
  the port's own check, which runs before the order is read so "forbidden" and "not found" cannot be
  told apart. **A04** verified by grep rather than by comment — the only writes to `orders.status`
  anywhere are `transition` and `applyPaymentEvent`, both under the row lock; `payloadShipping` and
  `payloadFulfilment` both go through `transition`. **A08** signature before parse, idempotency by
  event id through `eventTrail`. **A09** every log line carries order number, AWB, decision and
  counts, and no PII; `queueNotification` logs nothing at all. **A10** `Shipment.labelUrl` is stored
  and handed to staff, never fetched, and the simulate route calls the webhook handler as a function
  rather than over the network.
  **Next: J6 — notifications**, which absorbs `lib/notify/queue.ts` into the dispatcher: this stage
  wrote the row directly, as the journey allows, and the four jobs are its first callers. Owner to
  run `npm run test:e2e` (still only proves J3 — no spec covers cart → checkout, let alone
  fulfilment, and that gap is now the largest untested surface) and `npm run build`. `npm run seed`
  only if the catalog is stale; the schema did not change this session. To exercise fulfilment
  locally: set `CRON_SECRET` in `.env.local` before calling any `/api/cron/*` route — an unset secret
  refuses every request by design.
- 2026-07-28 [J6]: **Notifications complete.** `npm run check` green — 1359 unit tests (up from
  1308). `docs/ARCHITECTURE.md` §12 written and retitled from "Notifications — email and WhatsApp",
  since naming two providers described J11 rather than what this stage built. No migration:
  `notifications` has existed since J1.
  **The decision that shaped the stage: where a message is fired from.** The obvious answer is "at
  each place something happens" — checkout sends one, the shipping port sends one — and that is
  exactly the scattered `send()` calls CLAUDE.md forbids, because the coverage it produces depends on
  everyone remembering. J4 had already made `payloadOrders.transition` the *only* path a status can
  take, so hooking it there makes the customer's timeline complete by construction, the same argument
  that makes the audit trail complete.
  **That argument then found its own hole, which was the important part.** `applyPaymentEvent` does
  not call `transition` — it writes `status` and `paymentStatus` in one update because its audit row
  carries the event id — so hooking `transition` alone would have left `order.confirmed` as the one
  status message never sent. That is the email customers actually wait for. Hooked separately, with a
  test that says why. `order.placed` is the third seam: an order is *born* at `pending`, and
  `statusNotification.ts` deliberately says nothing about entering the status an order started in, so
  checkout sends it.
  Four statuses answer null on purpose and the map is exhaustive over `OrderStatus`, so a new status
  has to be given an answer rather than defaulting to silence. `packed` is a box on a table, not
  news; `rto` needs staff, not a message about a failure the customer may not have caused;
  `payment_failed` is already on the screen they are looking at; `returned` is silent because the
  refund that follows is the thing worth saying.
  **The type that stopped a whole class of bug**: `NotificationVariables` maps each event to exactly
  its own fields, and `NotificationMessage` distributes that over the union — so a caller that
  decides the event at runtime (which `statusNotification.ts` does) can still build a pair, and
  `order.shipped` cannot be paired with an abandoned cart's variables. Cost: one cast, contained
  inside `renderNotification`, because TypeScript cannot carry the correlation through an indexed
  lookup into the template table. Containing it there kept `as` out of the dispatcher entirely.
  What a template variable may hold turned out to be a **security** decision rather than a formatting
  one: `notifications.payload` is written straight from that object and read by every support agent,
  so a test asserts the recipient's address never appears in the stored JSON. The address is a
  column, deliberately.
  On the dispatcher never throwing: `NotificationChannel.send` already promises an outcome rather
  than a throw, and the send is wrapped anyway — a real SDK will break that promise the first time
  its socket does. There is an outer catch for the database failing too, and it logs loudly, because
  a silent swallow is how sending quietly stops working. Both paths are tested, as is a transition
  completing while the dispatcher rejects.
  Also worth keeping: a *failed* send writes a row, an *unreachable* recipient does not. "I never
  received my shipping confirmation" is the question this table exists to answer, so a failure with
  its reason belongs in it — but a guest with no email is not a failure, there is nothing to retry
  and nobody to tell, and recording it would bury the rows somebody can act on.
  `NOTIFICATION_PROVIDER` documented in `.env.example`; the factory reads it and refuses `console` in
  production, exactly as the payment and shipping factories do.
  **Next: J7 — customer support.** Ticket collection, a customer "My Requests" view and an admin
  inbox with reply and assignment — plain CRUD, no spend; the Claude assistant is deferred to J11.
  Owner to run `npm run test:e2e` (still only proves J3) and `npm run build`. `npm run seed` only if
  the catalog is stale — the schema has not changed since J1. To see notifications locally, place an
  order and watch the dev server console: the console channel prints each message in full.
