/**
 * Assembling a product into the two shapes the storefront renders: a card and a page.
 *
 * Both are built from the same flattened variants, which is what keeps a grid cell and a product
 * page from ever disagreeing about a price or a sold-out swatch.
 *
 * Two rules from `docs/DESIGN.md` §5 are encoded here rather than left to components. Sold-out
 * colours and sizes are shown and disabled, never removed — a customer who cannot find the size
 * they wore last time assumes the shop stopped making it. And the set of size pills is the
 * product's whole size range, not the range that happens to exist in the selected colour, so
 * switching swatch never makes pills appear and vanish under the cursor.
 */
import type { Category, Product, SizeChart } from '@/payload-types'

import { galleryFor } from './gallery'
import type {
  ImageView,
  PriceRange,
  ProductCardView,
  ProductDetailView,
  RichText,
  SeoView,
  SizeChartView,
  SizePillView,
  SwatchView,
  VariantView,
} from './types'
import { toVariantViews } from './variantView'

/**
 * Below this many units left, a card or a pill says so.
 *
 * A technical default rather than an owner-facing setting for now. If the owner ever wants to
 * tune the urgency, this moves to the `settings` global and is read through it — it must not
 * grow copies scattered through components in the meantime.
 */
export const LOW_STOCK_THRESHOLD = 5

/** Cheapest and dearest variant. Equal bounds render as a single price; empty reads as zero. */
export function priceRangeOf(variants: readonly VariantView[]): PriceRange {
  if (variants.length === 0) return { minPaise: 0, maxPaise: 0 }

  let minPaise = Number.POSITIVE_INFINITY
  let maxPaise = Number.NEGATIVE_INFINITY

  for (const variant of variants) {
    if (variant.pricePaise < minPaise) minPaise = variant.pricePaise
    if (variant.pricePaise > maxPaise) maxPaise = variant.pricePaise
  }

  return { minPaise, maxPaise }
}

/**
 * The colour swatches for a product, first-seen order preserved.
 *
 * The variants arrive already sorted by the variant layer, so first-seen is the owner's intended
 * colour order. A colour whose every size is gone still gets a swatch, marked unavailable.
 */
export function swatchesFor(variants: readonly VariantView[]): SwatchView[] {
  const byId = new Map<number, SwatchView>()

  for (const variant of variants) {
    const existing = byId.get(variant.colourId)
    if (existing) {
      if (variant.isAvailable) existing.isAvailable = true
      continue
    }

    byId.set(variant.colourId, {
      id: variant.colourId,
      name: variant.colourName,
      slug: variant.colourSlug,
      hex: variant.colourHex,
      isAvailable: variant.isAvailable,
    })
  }

  return [...byId.values()]
}

/**
 * Which swatch is selected when the page opens.
 *
 * The first colour with something left to sell, so a customer does not land on a page whose every
 * size is disabled. Falls back to the first swatch when the product is sold out entirely — the
 * page still has to show a colour — and to null when there are no swatches at all.
 */
export function defaultColourIdFor(swatches: readonly SwatchView[]): number | null {
  const available = swatches.find((swatch) => swatch.isAvailable)
  if (available) return available.id

  return swatches[0]?.id ?? null
}

/**
 * One pill per size the product is made in, whatever colour is selected.
 *
 * A size the selected colour does not come in gets a pill with `variantId: null` and no stock:
 * it reads to a customer exactly as sold out does, which is the honest answer, and it cannot be
 * added to a cart because there is no row to add.
 *
 * `colourId: null` means no colour has been chosen yet — on a card, or before hydration — so
 * availability is aggregated across every colour. The `variantId` then points at the first
 * sellable row for that size, which is the one a quick-add would use.
 */
export function sizePillsFor(
  variants: readonly VariantView[],
  colourId: number | null,
): SizePillView[] {
  const sizes = new Map<number, { label: string; sortOrder: number }>()

  for (const variant of variants) {
    if (sizes.has(variant.sizeId)) continue
    sizes.set(variant.sizeId, { label: variant.sizeLabel, sortOrder: variant.sizeSortOrder })
  }

  const ordered = [...sizes.entries()].sort(([idA, a], [idB, b]) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    if (a.label !== b.label) return a.label < b.label ? -1 : 1
    return idA - idB
  })

  return ordered.map(([sizeId, size]) => {
    const matching = variants.filter(
      (variant) =>
        variant.sizeId === sizeId && (colourId === null || variant.colourId === colourId),
    )

    const available = matching.reduce((total, variant) => total + variant.availableQty, 0)
    const sellable = matching.find((variant) => variant.isAvailable) ?? matching[0] ?? null
    const isAvailable = available > 0

    return {
      sizeId,
      label: size.label,
      sortOrder: size.sortOrder,
      variantId: sellable?.id ?? null,
      availableQty: available,
      isAvailable,
      isLow: isAvailable && available <= LOW_STOCK_THRESHOLD,
    }
  })
}

/**
 * The strike-through price, or null when there is nothing honest to strike through.
 *
 * The highest compare-at across the variants, reported only when it is genuinely above the price
 * the customer would pay. A compare-at equal to or below the price is a discount that does not
 * exist, and printing one is the kind of thing that gets a shop fined.
 */
function highestCompareAt(variants: readonly VariantView[], minPaise: number): number | null {
  let highest: number | null = null

  for (const variant of variants) {
    const compareAt = variant.compareAtPricePaise
    if (compareAt === null) continue
    if (highest === null || compareAt > highest) highest = compareAt
  }

  return highest !== null && highest > minPaise ? highest : null
}

/** Total units left across every variant, reported only when it is low enough to be worth saying. */
function lowStockQtyFor(variants: readonly VariantView[]): number | null {
  const total = variants.reduce((sum, variant) => sum + variant.availableQty, 0)
  return total > 0 && total <= LOW_STOCK_THRESHOLD ? total : null
}

/**
 * The gallery reordered so the images of the default colour come first.
 *
 * Everything else keeps its place behind them, so a product whose default colour has a single
 * photograph still has a second, different image to reveal on hover.
 */
function cardImages(images: readonly ImageView[], defaultColourId: number | null): ImageView[] {
  const preferred = galleryFor(images, defaultColourId)
  const preferredIds = new Set(preferred.map((image) => image.id))

  return [...preferred, ...images.filter((image) => !preferredIds.has(image.id))]
}

/** Falls through a list of maybe-set strings, treating blank as unset. Returns null if all are. */
function firstFilled(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function ogImageUrlFor(
  seoImage: Product['seo'] | Category['seo'],
  images: readonly ImageView[],
): string | null {
  const ogImage = seoImage?.ogImage
  if (typeof ogImage === 'object' && ogImage !== null) {
    const url = ogImage.url
    if (typeof url === 'string' && url.length > 0) return url
  }

  // The first product photograph is a better share card than nothing at all.
  return images[0]?.url ?? null
}

/**
 * Metadata for a category page.
 *
 * Lives beside the product builder because the fallback chain is the same decision made twice,
 * and two copies of it would drift.
 */
export function toCategorySeoView(
  category: Category,
  images: readonly ImageView[] = [],
): SeoView {
  return {
    title: firstFilled(category.seo?.title, category.title) ?? category.title,
    description: firstFilled(category.seo?.description),
    ogImageUrl: ogImageUrlFor(category.seo, images),
    canonicalPath: `/c/${category.slug}`,
  }
}

function toProductSeoView(product: Product, images: readonly ImageView[]): SeoView {
  return {
    title: firstFilled(product.seo?.title, product.title) ?? product.title,
    // The fabric is the only other sentence the owner reliably writes, and it is a better
    // search snippet than a truncated rich-text description would be.
    description: firstFilled(product.seo?.description, product.fabric),
    ogImageUrl: ogImageUrlFor(product.seo, images),
    canonicalPath: `/p/${product.slug}`,
  }
}

function toSizeChartView(chart: SizeChart | null): SizeChartView | null {
  if (!chart) return null

  return {
    title: chart.title,
    group: chart.group,
    rows: chart.measurements.map((row) => ({
      sizeLabel: row.sizeLabel,
      chestIn: row.chestIn ?? null,
      waistIn: row.waistIn ?? null,
      lengthIn: row.lengthIn ?? null,
      shoulderIn: row.shoulderIn ?? null,
    })),
    notes: chart.notes ?? null,
  }
}

/** A grid cell. Deliberately small — a listing page builds dozens of these per request. */
export function toProductCardView(
  product: Product,
  variants: readonly unknown[],
  images: readonly ImageView[],
): ProductCardView {
  const variantViews = toVariantViews(variants, product.mrp)
  const swatches = swatchesFor(variantViews)
  const defaultColourId = defaultColourIdFor(swatches)
  const priceRange = priceRangeOf(variantViews)
  const ordered = cardImages(images, defaultColourId)
  const image = ordered[0] ?? null

  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    categorySlug: typeof product.category === 'object' ? product.category.slug : null,
    image,
    hoverImage: image ? (ordered.find((other) => other.id !== image.id) ?? null) : null,
    priceRange,
    compareAtPricePaise: highestCompareAt(variantViews, priceRange.minPaise),
    swatches,
    // A product with no sellable variant is sold out, including one with no variants at all.
    isSoldOut: variantViews.every((variant) => !variant.isAvailable),
    lowStockQty: lowStockQtyFor(variantViews),
  }
}

export interface ProductDetailInput {
  product: Product
  variants: readonly unknown[]
  images: readonly ImageView[]
  category: Category | null
  sizeChart: SizeChart | null
}

/**
 * A product page.
 *
 * Every image is carried, not just the default colour's — the client filters with `galleryFor`
 * as the customer changes swatch, and a round trip to refetch photographs the page already had
 * would be a visible stall on a slow connection.
 */
export function toProductDetailView(input: ProductDetailInput): ProductDetailView {
  const { product, category, sizeChart } = input
  const images = [...input.images]
  const variants = toVariantViews(input.variants, product.mrp)
  const swatches = swatchesFor(variants)
  const priceRange = priceRangeOf(variants)
  const description: RichText = product.description ?? null

  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description,
    fabric: product.fabric ?? null,
    careInstructions: product.careInstructions ?? null,
    fitNotes: product.fitNotes ?? null,
    taxRatePct: product.taxRatePct,
    mrpPaise: product.mrp,
    categoryId: category?.id ?? null,
    categoryTitle: category?.title ?? null,
    categorySlug: category?.slug ?? null,
    sizeChart: toSizeChartView(sizeChart),
    images,
    swatches,
    defaultColourId: defaultColourIdFor(swatches),
    variants,
    priceRange,
    compareAtPricePaise: highestCompareAt(variants, priceRange.minPaise),
    seo: toProductSeoView(product, images),
    updatedAt: product.updatedAt,
  }
}
