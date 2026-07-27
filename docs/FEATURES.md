# FEATURES.md — Owner's Feature Requests

**This file belongs to the owner.** Add features here in plain language — no format required,
bullet points or a sentence is enough. Claude reads this file at the start of every session,
turns new entries into properly specced stages in `CLAUDE.md`, and builds them in order.

## How it works

1. You add a feature under **Inbox** below. One line is fine.
2. Next session, Claude moves it to **Specced** with a full spec (data, UI, rules, tests) and
   appends a matching stage (`J11`, `J12`, …) to the journey in `CLAUDE.md`.
3. When built and tested, it moves to **Shipped** with the date.
4. Anything unclear gets moved to **Needs Input** with a specific question — answer it inline.

Priority tags are optional: `[P0]` blocks launch · `[P1]` soon after · `[P2]` nice to have.

---

## Inbox — new requests

<!-- Add new features below this line. Anything here gets specced next session. -->

- 

---

## Needs Input — Claude has a question

<!-- Answer inline under each question, then leave it here. It'll move on next session. -->

_(none yet)_

---

## Specced — ready to build

<!-- Written by Claude. Each entry links to its journey stage in CLAUDE.md. -->

_(none yet)_

---

## Shipped

<!-- Completed features with the date and the stage that delivered them. -->

- **2026-07-27 · rate limiting keyed on the real client IP.** Raised by the J4 security pass:
  `clientKey` took the **left-most** `x-forwarded-for` entry, which is whatever the caller sent, so
  rotating that header earned a fresh allowance per request and defeated the coupon-apply limit.
  Owner confirmed the deployment has nothing in front of Railway — no custom domain, and Cloudflare
  is used for R2 media only — so `TRUSTED_PROXY_HOPS` defaults to **1** and `clientIpFrom` counts one
  entry from the right, which on Railway is the peer address its edge appended and an outsider cannot
  forge. An unattributable caller shares one `unknown` bucket rather than getting a private one.

---

## Already in the plan (don't re-add)

These are part of the base journey J0–J10 in `CLAUDE.md`:

- Product catalog with size × colour variants, per-variant stock and SKUs
- Category tree, size charts, colour swatches
- Filters: category, size, colour, price, in-stock
- Cart, guest checkout, Razorpay payments, GST, coupons
- Shiprocket shipping, order tracking, order status timeline
- Email notifications (Resend) — full order lifecycle
- WhatsApp notifications (Meta Cloud API) — confirmed, shipped, delivered
- Customer support ticket system + Claude-powered chatbot
- Returns and size exchange
- Wishlist with back-in-stock alerts
- Reviews with photos and fit feedback
- Loyalty points
- Role-based staff access (super_admin, catalog_manager, order_manager, support_agent, marketing)
- Cron scheduler — abandoned cart, status sync, stock alerts, review requests
- SEO: metadata, JSON-LD, sitemap, OG images
- Admin: bulk variant generator, stock ledger, CSV import/export, dashboard
