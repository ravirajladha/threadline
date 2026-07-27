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

### Rate limiting can be bypassed by setting a header — how many proxies should we trust?

Found during the J4 security pass, 2026-07-27. Not urgent, but it should be closed before real
money flows.

`clientKey` in `src/lib/http/rateLimit.ts` identifies a caller by the **left-most** entry of the
`x-forwarded-for` header. That entry is whatever the client sent: a script can put a random value in
it on every request and get a fresh allowance each time, which defeats the coupon-apply limit — the
one that exists specifically to stop someone guessing valid codes.

The fix is to count entries from the **right** instead, skipping exactly as many as there are
proxies we control, because those are the only entries an outsider cannot forge. That number is a
fact about the deployment rather than a coding decision, and guessing it fails badly in both
directions: too few and the bypass stays open, too many and every visitor behind the same edge node
shares one bucket, so the storefront starts refusing real shoppers.

**Question:** on Railway, does anything sit in front of the app that we control — Cloudflare, a
custom domain proxy, anything else — or does traffic reach it through Railway's edge alone?

Once answered this becomes a `TRUSTED_PROXY_HOPS` setting read in one place, plus a test per hop
count. Until then the limiter is a throttle against ordinary traffic, which is what it is documented
in code as being.

---

## Specced — ready to build

<!-- Written by Claude. Each entry links to its journey stage in CLAUDE.md. -->

_(none yet)_

---

## Shipped

<!-- Completed features with the date and the stage that delivered them. -->

_(none yet)_

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
