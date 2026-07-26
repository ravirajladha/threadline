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

See `docs/SCHEMA.md`. Implemented in J1. _pending_

## 6. Access control and roles

Five staff roles plus customers. Matrix in `docs/SCHEMA.md`; implementation in `src/access/`. _pending_

## 7. Payments — Razorpay

_pending (J4)_

## 8. Shipping — Shiprocket

_pending (J5)_

## 9. Scheduler

_pending (J5)_

## 10. Notifications — email and WhatsApp

_pending (J6)_

## 11. Customer support and AI assistant

_pending (J7)_

## 12. SEO

_pending (J9)_

## 13. Deployment

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

- **2026-07-26 (J0)** — Foundation. Next 16 + Payload 3.86 + Neon Postgres, route groups, folder
  structure, design tokens, `Money`, Vitest and Playwright harnesses, OWASP baseline documented.
