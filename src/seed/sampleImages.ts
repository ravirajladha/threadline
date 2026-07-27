/**
 * Fictional product photography, generated in memory.
 *
 * The seed needs a gallery per product or the storefront being built in J3 has nothing to
 * render, but this repo is public (CLAUDE.md §2) — downloading stock photography, even
 * royalty-free, would mean redistributing someone else's image through a public git history
 * forever. Rendering an SVG label card through `sharp` sidesteps that entirely: every byte is
 * generated from the product's own name and colour, nothing is fetched, and nobody can mistake
 * the result for real photography because it is deliberately signed as a placeholder.
 *
 * The two pure pieces — the SVG template and the colour maths that keeps its text readable —
 * are exported separately from the `sharp` calls so they can be unit-tested without paying for
 * a raster every time.
 */
import sharp from 'sharp'

import { slugify } from '@/lib/utils/slug'

export interface SampleImage {
  filename: string
  alt: string
  buffer: Buffer
  colourSlug: string
}

/**
 * Everything about a sample image except the pixels.
 *
 * The filename is what the seed matches an existing media row on, and deriving it costs a string
 * concatenation while producing the image it names costs a raster. Splitting the two lets the
 * seed ask "do I already have this?" before it pays — which is the difference between a re-seed
 * that regenerates 32 images it then throws away and one that generates none.
 */
export interface SampleImagePlan {
  filename: string
  alt: string
  colourSlug: string
  svg: string
}

/** `docs/DESIGN.md` fixes the catalog at 4:5 portrait — 1000×1250 is that ratio at a web size. */
export const SAMPLE_IMAGE_WIDTH = 1000
export const SAMPLE_IMAGE_HEIGHT = 1250

/** Enough for a hover-swap second image without the seed spending minutes rasterising SVGs. */
const DEFAULT_PER_COLOUR = 2

/** Small variety in the corner label so a product's own images aren't visually identical. */
const VARIANT_LABELS = ['Front', 'Detail'] as const

function variantLabelFor(index: number): string {
  return VARIANT_LABELS[index - 1] ?? `Look ${index}`
}

// --- Colour maths -------------------------------------------------------------------

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const LONG_HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

/**
 * Accepts `#rgb` or `#rrggbb`, case-insensitive, and returns the lower-cased six-digit form.
 *
 * Every downstream step — the SVG fill, the luminance sum — assumes a clean six-digit value.
 * Validating once here means a bad colour fails loudly with a `RangeError` instead of producing
 * an SVG with an invalid `fill` attribute that `sharp` then rejects with a much less useful error.
 */
export function normaliseHex(hex: string): string {
  const short = SHORT_HEX.exec(hex)
  if (short) {
    const [, r, g, b] = short
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }

  if (LONG_HEX.test(hex)) return hex.toLowerCase()

  throw new RangeError(`Expected a #rgb or #rrggbb colour, received ${JSON.stringify(hex)}`)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalised = normaliseHex(hex)
  return {
    r: parseInt(normalised.slice(1, 3), 16),
    g: parseInt(normalised.slice(3, 5), 16),
    b: parseInt(normalised.slice(5, 7), 16),
  }
}

/**
 * WCAG relative luminance of a hex colour, in the 0 (black) – 1 (white) range.
 *
 * This is what decides whether the label text on a swatch as dark as Indigo or as light as
 * Ecru stays legible — a fixed text colour would vanish against roughly half the palette.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

/** Off-white on a dark swatch, near-black on a light one — never pure `#fff`/`#000`. */
export function readableTextColour(hex: string): string {
  return relativeLuminance(hex) > 0.5 ? '#161412' : '#f8f5ef'
}

/**
 * Nudges `hex` towards white (`amount` > 0) or black (`amount` < 0) by `amount` (0–1).
 * Used for the background gradient and the tone-on-tone silhouette, so both stay clearly
 * derived from the product's own colour rather than an unrelated grey.
 */
function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const target = amount >= 0 ? 255 : 0
  const t = Math.min(Math.abs(amount), 1)
  const mix = (channel: number) => Math.round(channel + (target - channel) * t)

  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// --- XML escaping -------------------------------------------------------------------

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

/**
 * Escapes the five XML-significant characters so arbitrary product copy — an ampersand in a
 * title, a stray quote — cannot break out of the `<text>` element it is placed in. Without this
 * a title like `Tom & Jerry's Shirt` produces invalid XML and `sharp` throws on the raster step,
 * taking the whole seed down with it.
 */
export function escapeSvgText(input: string): string {
  return input.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)
}

// --- SVG template -------------------------------------------------------------------

/** Loose, hand-drawn shoulders-and-body outline — legible as "a garment", nothing more specific. */
const GARMENT_SILHOUETTE_PATH =
  'M500 300 C 440 300 400 322 358 356 L 258 424 L 302 526 L 362 486 L 362 984 L 638 984 ' +
  'L 638 486 L 698 526 L 742 424 L 642 356 C 600 322 560 300 500 300 Z'

export interface SampleImageSvgInput {
  productTitle: string
  colourName: string
  colourHex: string
  variantLabel?: string
}

/**
 * Builds the placeholder card as an SVG string: a soft gradient in the product's own colour, an
 * abstract garment silhouette a shade darker, a "SAMPLE" badge that stops it ever being mistaken
 * for real photography, and the product title and colour name set in the text colour that
 * `readableTextColour` picked for this particular swatch.
 */
export function sampleImageSvg(input: SampleImageSvgInput): string {
  const hex = normaliseHex(input.colourHex)
  const textColour = readableTextColour(hex)
  const gradientTop = shade(hex, 0.16)
  const silhouette = relativeLuminance(hex) > 0.5 ? shade(hex, -0.14) : shade(hex, 0.14)

  const title = escapeSvgText(input.productTitle)
  const colourName = escapeSvgText(input.colourName)
  const label = input.variantLabel ? escapeSvgText(input.variantLabel) : undefined
  const labelMarkup = label
    ? `<text x="${SAMPLE_IMAGE_WIDTH - 72}" y="76" text-anchor="end" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="20" fill="${textColour}" opacity="0.75">${label}</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE_IMAGE_WIDTH}" height="${SAMPLE_IMAGE_HEIGHT}" viewBox="0 0 ${SAMPLE_IMAGE_WIDTH} ${SAMPLE_IMAGE_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${gradientTop}" />
      <stop offset="100%" stop-color="${hex}" />
    </linearGradient>
  </defs>
  <rect width="${SAMPLE_IMAGE_WIDTH}" height="${SAMPLE_IMAGE_HEIGHT}" fill="url(#bg)" />
  <path d="${GARMENT_SILHOUETTE_PATH}" fill="${silhouette}" opacity="0.55" />
  <ellipse cx="500" cy="330" rx="55" ry="24" fill="${gradientTop}" opacity="0.9" />
  <rect x="48" y="48" width="150" height="44" rx="22" fill="${textColour}" opacity="0.12" />
  <text x="72" y="76" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="20" font-weight="600" letter-spacing="2" fill="${textColour}">SAMPLE</text>
  ${labelMarkup}
  <text x="${SAMPLE_IMAGE_WIDTH / 2}" y="1120" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="42" font-weight="700" fill="${textColour}">${title}</text>
  <text x="${SAMPLE_IMAGE_WIDTH / 2}" y="1170" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="26" fill="${textColour}" opacity="0.85">${colourName}</text>
</svg>`
}

// --- Rendering -------------------------------------------------------------------

/**
 * SVG in, WebP out — and the one step in this module that depends on something other than its
 * own inputs.
 *
 * `sharp` can only read SVG where the libvips it was built against includes librsvg, and the
 * text in the card needs a font that fontconfig can actually resolve. Neither is true
 * everywhere, and when either is missing the failure arrives as a bare `sharp` message with no
 * indication of which of the dozens of images in a seed run produced it. Naming the image in the
 * wrapper is what turns that into something diagnosable; `cause` keeps the original intact.
 */
async function rasterise(svg: string, filename: string): Promise<Buffer> {
  try {
    // Quality 55 keeps these at a few KB each — they are placeholders, not assets to optimise.
    return await sharp(Buffer.from(svg)).webp({ quality: 55 }).toBuffer()
  } catch (cause) {
    throw new Error(`Could not rasterise the sample image ${filename}`, { cause })
  }
}

/** Rasterises one planned image. Everything expensive about a sample image happens here. */
export async function renderPlannedImage(plan: SampleImagePlan): Promise<SampleImage> {
  return {
    filename: plan.filename,
    alt: plan.alt,
    colourSlug: plan.colourSlug,
    buffer: await rasterise(plan.svg, plan.filename),
  }
}

/**
 * Renders one placeholder image standalone, deriving its filename and colour slug from
 * `productTitle`/`colourName` via the same `slugify` the collections use. Handy on its own —
 * in a test, or anywhere a single card is wanted — but the seed itself calls `renderSampleImages`
 * so that the filename is built from the product's and colour's *actual* persisted slugs rather
 * than a value recomputed from their current name.
 */
export async function renderSampleImage(input: {
  productTitle: string
  colourName: string
  colourHex: string
  index: number
}): Promise<SampleImage> {
  const svg = sampleImageSvg({
    productTitle: input.productTitle,
    colourName: input.colourName,
    colourHex: input.colourHex,
    variantLabel: variantLabelFor(input.index),
  })

  const colourSlug = slugify(input.colourName)
  const filename = `${slugify(input.productTitle)}-${colourSlug}-${input.index}.webp`
  return {
    filename,
    alt: `${input.productTitle} in ${input.colourName}`,
    buffer: await rasterise(svg, filename),
    colourSlug,
  }
}

export interface SampleImageSetInput {
  productTitle: string
  productSlug: string
  colours: readonly { name: string; slug: string; hex: string }[]
  perColour?: number
}

/**
 * Names and composes `perColour` sample images for each colour a product is offered in, without
 * rasterising any of them.
 *
 * Filenames are built from `productSlug` and each colour's own `slug` — not recomputed from
 * their titles — because that is what the seed's idempotency depends on: re-running it must
 * derive the exact same filename it derived last time so the "does a media row with this
 * filename already exist" check in `src/seed/index.ts` actually matches.
 *
 * A bad colour fails here, before any raster is attempted, which is the whole reason
 * `normaliseHex` validates rather than trusting its input.
 */
export function planSampleImages(input: SampleImageSetInput): SampleImagePlan[] {
  const perColour = input.perColour ?? DEFAULT_PER_COLOUR
  const plans: SampleImagePlan[] = []

  for (const colour of input.colours) {
    for (let index = 1; index <= perColour; index += 1) {
      plans.push({
        filename: `${input.productSlug}-${colour.slug}-${index}.webp`,
        alt: `${input.productTitle} in ${colour.name}`,
        colourSlug: colour.slug,
        svg: sampleImageSvg({
          productTitle: input.productTitle,
          colourName: colour.name,
          colourHex: colour.hex,
          variantLabel: variantLabelFor(index),
        }),
      })
    }
  }

  return plans
}

/**
 * Plans and rasterises a product's whole set in one call.
 *
 * The seed itself does not use this — it plans first so it can skip the images it already has —
 * but rendering a complete set is what a test or a one-off script wants, and having both keeps
 * the two-step version from being the only way to ask a simple question.
 */
export async function renderSampleImages(input: SampleImageSetInput): Promise<SampleImage[]> {
  const images: SampleImage[] = []
  for (const plan of planSampleImages(input)) {
    images.push(await renderPlannedImage(plan))
  }

  return images
}
