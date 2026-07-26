# DESIGN.md — Design System & UI Rules

Minimal, modern, fast. The clothes are the design; the interface gets out of the way.

---

## Principles

1. **Product photography is the hero.** Everything else is neutral scaffolding.
2. **One accent colour.** Used for actions only — never decoration.
3. **Whitespace over borders.** Separate with space, not lines and boxes.
4. **Type does the work.** A confident type scale replaces most visual ornament.
5. **Never hide sold-out sizes.** Show them disabled — hiding them is the #1 clothing UX mistake and it silently kills conversions.
6. **Every interactive element has a visible loading and error state.** No dead clicks.

---

## Tokens

Defined once in `src/styles/tokens.css` as CSS custom properties, mapped onto Tailwind's theme in `src/styles/globals.css`. Components use utilities (`bg-surface`, `text-fg-muted`, `border-border`) and **never** a raw hex.

```
--bg --surface --surface-raised     page and card backgrounds
--border --border-strong            hairlines
--fg --fg-muted --fg-subtle         text, descending in contrast
--accent --accent-hover
--accent-fg --accent-subtle         the single brand colour and what sits on it
--success --warning --danger --info
--radius-control --radius-card
--duration-fast --duration-base --ease-out
```

### Rebranding is a four-line change

The top of `tokens.css` holds `--brand-accent`, `--brand-accent-hover`, `--brand-accent-fg` and `--brand-accent-subtle`. Change those and the entire storefront follows — nothing else hardcodes a colour.

**Current accent: mulberry `#b04b76`** — a pink that leans plum rather than candy. Dark mode lifts it to `#e58ab0` so it keeps contrast against a near-black background.

**Dark mode is required**, via `prefers-color-scheme` plus a `data-theme` attribute that overrides the OS preference in both directions. Every token has a dark value.

### Type scale
One display face for headings, one neutral sans for UI. Scale: `12 / 14 / 16 / 20 / 24 / 32 / 48`.
Body 16px minimum. Line height 1.5 body, 1.15 display.

### Spacing
4px base. Use `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64` only. No arbitrary values.

### Radius & elevation
One radius for cards, one for controls. Shadows used sparingly — borders and background shifts preferred.

---

## Asset structure

```
public/assets/
├─ brand/         logo.svg · logo-dark.svg · wordmark.svg · favicon.ico · og-default.png
├─ icons/         only icons not in lucide — prefer the icon library
└─ placeholders/  product-fallback.webp · avatar-fallback.svg
```

**Rules**
- Product images never live here — they go to S3 via Payload media.
- SVG for anything vector. WebP/AVIF for raster. No PNG screenshots in production paths.
- Every image through `next/image` with explicit `width`/`height` or `fill` + sized container. No layout shift.
- Product images: 4:5 portrait, consistent across the catalog. Enforce on upload.

---

## Key screens

### Listing
Responsive grid — 2 columns mobile, 3 tablet, 4 desktop. Filter rail on desktop, bottom sheet on mobile.
Filters: category, size, colour, price range, in-stock only. Filters are URL state (shareable, back-button safe).
Card shows: image, hover/second image, title, price with strikethrough, colour swatches, "Only 2 left" when low.
Infinite scroll with a working "load more" fallback. Skeleton cards while loading.

### Product detail
- Gallery left (sticky on desktop), details right. Gallery filters to the selected colour.
- Colour swatches → size pills → quantity → add to cart.
- Sold-out sizes: struck through, muted, still clickable to trigger "Notify me".
- Size chart opens in a modal, in inches **and** cm, with the fit note.
- Trust row: delivery estimate by pincode, return window, secure payment.
- Accordions: description, fabric & care, shipping & returns.
- Sticky add-to-cart bar on mobile once the buy box scrolls out.
- Below: complete-the-look, recently viewed, reviews with fit feedback.

### Cart & checkout
Cart as a drawer, not a page interrupt. Checkout is a **single page, sectioned** — address, delivery, payment —
with a persistent order summary. No account required to buy. Every price change animates so nothing shifts silently.

### Account
Orders with visual status timeline, track link, one-tap reorder, returns/exchange entry point, wishlist, addresses.

---

## Motion
Fast and functional: 150–200ms, ease-out. Animate opacity and transform only.
Respect `prefers-reduced-motion` — disable all non-essential motion.

## Accessibility (non-negotiable)
Contrast ≥ 4.5:1 body text. Every interactive element keyboard-reachable with a visible focus ring.
Size pills are real radio inputs. Images have alt text from the product title + colour.
Modals trap focus and close on Escape.

## Performance budget
LCP < 2.0s on 4G mobile · CLS < 0.05 · JS shipped to the listing page < 120KB gzipped.
Server Components by default; `"use client"` only for genuine interactivity.
