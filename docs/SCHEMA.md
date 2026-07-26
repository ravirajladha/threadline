# SCHEMA.md — Data Model

Source of truth for Payload collections. Update this **before** changing code.
Money is stored as **integer paise**. Dates are UTC. Every collection has `id`, `createdAt`, `updatedAt`.

---

## Catalog

### `categories`
Self-referencing tree: Men → Topwear → Shirts.

| Field | Type | Notes |
|---|---|---|
| `title` | text | required |
| `slug` | text | unique, indexed |
| `parent` | relation → categories | nullable = root |
| `sizeGroup` | select | `topwear` `bottomwear` `kids` `footwear` `free` — drives which sizes apply |
| `sizeChart` | relation → sizeCharts | nullable |
| `image`, `description` | media, richText | |
| `seo` | group | title, description, ogImage |
| `sortOrder`, `isActive` | number, checkbox | |

### `sizes`
| Field | Type | Notes |
|---|---|---|
| `label` | text | `S`, `XL`, `32`, `4-5Y` |
| `group` | select | must match `categories.sizeGroup` |
| `sortOrder` | number | **critical** — without it pills render S, XL, L, M |

### `colours`
`name`, `hex`, `sortOrder`. Drives swatches and gallery grouping.

### `products` — the *style* level. Does not sell.
| Field | Type | Notes |
|---|---|---|
| `title`, `slug` | text | slug unique, indexed |
| `category` | relation → categories | required |
| `description` | richText | |
| `fabric`, `careInstructions`, `fitNotes` | text | clothing-specific, drives returns down |
| `mrp` | number (paise) | default for variants |
| `taxRatePct` | number | GST slab — 5 under ₹1000, 12 above (verify current rules) |
| `gallery` | array of { image, colour } | gallery filters by selected colour |
| `status` | select | `draft` `active` `archived` |
| `featured` | checkbox | |
| `seo` | group | |

### `variants` — **this is what sells.** One row per size × colour.
| Field | Type | Notes |
|---|---|---|
| `product` | relation → products | required, indexed |
| `size`, `colour` | relations | required |
| `sku` | text | unique, auto-generated `{PRODUCT}-{COLOUR}-{SIZE}` |
| `price` | number (paise) | overrides product mrp when set |
| `compareAtPrice` | number (paise) | strike-through |
| `stockQty` | number | **derived from stockMovements — never edited directly** |
| `reservedQty` | number | held by in-progress checkouts |
| `barcode`, `weightGrams` | text, number | weight required for Shiprocket |
| `isActive` | checkbox | |

Unique constraint on `(product, size, colour)`.
Available to sell = `stockQty − reservedQty`.

### `sizeCharts`
`title`, `group`, `measurements` (array of { sizeLabel, chestIn, waistIn, lengthIn, shoulderIn }), `notes`.

### `stockMovements` — append-only ledger
`variant`, `type` (`in` `out` `adjust` `return` `damage`), `qty` (signed), `reason`, `order` (nullable), `actor`.
Never update or delete a row. `variants.stockQty` is recalculated from this.

---

## Customers & access

### `users` — staff only
| Field | Type | Notes |
|---|---|---|
| `email`, `password` | Payload auth | |
| `name` | text | |
| `role` | select | see role matrix below |
| `isActive` | checkbox | |

**Role matrix** — enforced in each collection's `access` functions, not in the UI.
Implemented as data in `src/access/permissions.ts` and asserted against this table in
`tests/unit/permissions.spec.ts`. **The three must be changed together** — the test fails otherwise.

| Role | Catalog | Orders | Refunds | Support | Coupons | Customers | Users/Settings |
|---|---|---|---|---|---|---|---|
| `super_admin` | full | full | full | full | full | full | full |
| `catalog_manager` | full | read | — | — | — | — | — |
| `order_manager` | read | full | full | read | — | read | — |
| `support_agent` | read | read | — | full | — | read | — |
| `marketing` | read | read | — | — | full | — | — |

**Customers** is customer PII — accounts, addresses, wishlists. `marketing` is deliberately
excluded: a campaign tool does not need to read individual customer records, and least privilege
means it does not get to.

Each collection maps onto exactly one resource in that table. Beyond the staff matrix, a signed-in
**customer** may read and write only their own rows — enforced by returning a `Where` constraint
(`{ customer: { equals: me } }`) that Payload folds into the SQL, so another customer's row is
never fetched rather than fetched and filtered.

Three collections are **append-only** — `stockMovements`, `orderEvents`, `loyaltyTransactions`.
`update` and `delete` are denied to every role including `super_admin`; corrections are new rows.

### `customers` — storefront accounts (separate auth collection from staff)
`email`, `password`, `name`, `phone`, `whatsappOptIn`, `loyaltyPoints`, `emailVerified`, `lastSeenAt`.

### `addresses`
`customer`, `label`, `name`, `phone`, `line1`, `line2`, `city`, `state`, `pincode`, `country`, `isDefault`.
`state` drives the CGST/SGST vs IGST decision.

---

## Commerce

### `carts`
`customer` (nullable), `sessionId` (cookie, indexed), `items[]` { variant, qty, priceAtAdd },
`coupon`, `expiresAt`, `abandonedNotifiedAt`.
Guest cart merges into the customer cart on login.

### `orders`
| Field | Type | Notes |
|---|---|---|
| `orderNumber` | text | unique, human-readable |
| `customer`, `email`, `phone` | | |
| `shippingAddress`, `billingAddress` | group | **snapshot, not relation** |
| `status` | select | see state machine |
| `paymentMethod`, `paymentStatus` | select | `razorpay` `cod` |
| `razorpayOrderId`, `razorpayPaymentId` | text | indexed |
| `subtotal`, `shipping`, `taxTotal`, `discount`, `loyaltyDiscount`, `grandTotal` | number (paise) | must reconcile exactly |
| `taxBreakup` | group | cgst, sgst, igst |
| `coupon`, `awbCode`, `courier`, `shiprocketOrderId` | | |
| `placedAt`, `deliveredAt`, `cancelledAt` | date | |

**Status machine** — transitions validated in `lib/orders/transitions.ts`:
`pending → confirmed → packed → shipped → out_for_delivery → delivered`
with `cancelled`, `rto`, `payment_failed`, `returned`, `refunded` as terminal branches.
Illegal transitions throw. Every change writes an `orderEvents` row.

### `orderItems` — full snapshot, never joins live data
`order`, `variant` (reference only), `sku`, `productTitle`, `sizeLabel`, `colourName`, `image`,
`qty`, `unitPrice`, `taxRatePct`, `taxAmount`, `lineTotal`.

### `coupons`
`code` (unique, upper), `type` (`percent` `flat` `free_shipping`), `value`, `minCartValue`,
`maxDiscount`, `limitTotal`, `limitPerUser`, `usedCount`, `startsAt`, `endsAt`,
`appliesTo` (all / categories / products), `isActive`, `stackable`.

### `returns`
`order`, `items[]` { orderItem, qty, reason }, `type` (`return` `exchange`),
`exchangeVariant` (nullable — the different size they want), `status`
(`requested` `approved` `picked_up` `received` `refunded` `rejected` `exchange_shipped`),
`refundAmount`, `pickupAwb`, `customerNote`, `adminNote`.

### `loyaltyTransactions`
`customer`, `order`, `points` (signed), `type` (`earn` `redeem` `expire` `reverse`), `expiresAt`.
Rules: 1 pt per ₹1 of subtotal · 1 pt = ₹1 · max 10% of cart · min 50 to redeem · 1 year expiry ·
awarded on `delivered` · reversed on return.

---

## Engagement

### `reviews`
`product`, `customer`, `order` (verified purchase), `rating`, `title`, `body`, `photos[]`,
`fitFeedback` (`runs_small` `true_to_size` `runs_large`), `status` (`pending` `approved` `rejected`).

### `wishlists`
`customer`, `variant`, `notifyOnRestock`.

### `tickets` — customer support
`ticketNumber`, `customer`, `order` (nullable), `subject`, `category`
(`order` `return` `product` `payment` `other`), `status` (`open` `pending_customer` `resolved` `closed`),
`priority`, `assignedTo` (→ users), `messages[]` { author, authorType (`customer` `agent` `bot`), body, attachments, sentAt },
`escalatedFromBot` (checkbox), `firstResponseAt`, `resolvedAt`.

### `chatSessions` — Claude-powered assistant
`sessionId`, `customer` (nullable), `messages[]` { role, content, tokensIn, tokensOut },
`contextUsed` (which catalog/order data was injected), `handedOffTo` (→ tickets), `startedAt`, `endedAt`.

### `notifications` — delivery log for every outbound message
`channel` (`email` `whatsapp`), `event`, `recipient`, `templateKey`, `payload` (json),
`status` (`queued` `sent` `delivered` `failed` `read`), `providerId`, `error`, `sentAt`.
Failures are logged and **never block** the order flow.

---

## Config

### `settings` — global singleton, owner-editable, no code deploy needed
Free-shipping threshold, flat shipping rate, COD availability and fee, return window in days,
who pays return shipping, GST company state, support email/phone, WhatsApp opt-in default,
loyalty on/off, maintenance mode.

**Rule:** if the owner might ever want to change it, it belongs here — not in a constant.

---

## Indexes to create
`products.slug` · `categories.slug` · `variants.sku` · `variants.product` ·
`orders.orderNumber` · `orders.razorpayOrderId` · `orders.customer` · `carts.sessionId` ·
`stockMovements.variant` · `notifications.recipient`
