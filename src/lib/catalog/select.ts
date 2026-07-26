/**
 * Filtering, faceting, sorting and pagination over an already-loaded catalog.
 *
 * These are pure functions over `CatalogEntry[]`. That is a deliberate split: the Payload port
 * is responsible for *fetching* the catalog and nothing else, and every rule about what a
 * customer sees lives here, where it can be tested against a fixture instead of a database.
 *
 * Two decisions are encoded here that are easy to get wrong.
 *
 * **A facet constrains a variant, not a product.** "Size M" and "blue" together must mean the
 * product has a blue M — not that it has an M in some colour and a blue in some size. So the
 * filters are applied to the variant list and a product survives only if something is left.
 *
 * **A facet is not counted against itself.** The count beside "Blue" answers "how many products
 * would I get if I ticked this", so it is computed with every *other* facet applied and the
 * colour facet ignored. Counting with the colour filter already applied is what produces the
 * familiar broken rail where every unticked option reads zero.
 */
import type { Product } from '@/payload-types'
import type {
  CatalogFacets,
  CatalogFilters,
  CatalogSort,
  FacetValue,
  ImageView,
  PriceRange,
  VariantView,
} from './types'
import { PAGE_SIZE } from './types'

/**
 * One product with everything the listing needs, already normalised into view models.
 *
 * The flat fields are what the functions in this module sort and filter on. `product` is the
 * source document, carried along untouched so the port can build a card view from it without a
 * second read — nothing here reads it, which is what keeps these functions testable against a
 * handful of literals rather than a full Payload fixture.
 */
export interface CatalogEntry {
  id: number
  title: string
  slug: string
  featured: boolean
  createdAt: string
  categoryId: number | null
  categoryTitle: string | null
  categorySlug: string | null
  variants: VariantView[]
  images: ImageView[]
  product: Product
}

/** Which facet to leave out when counting. `null` applies every filter. */
type FacetKey = 'categories' | 'sizes' | 'colours' | 'price'

/**
 * The variants of `entry` that survive the filters — the ones a customer could actually pick
 * if they landed on the product page with this filter set in mind.
 */
export function selectVariants(
  entry: CatalogEntry,
  filters: CatalogFilters,
  except: FacetKey | null = null,
): VariantView[] {
  const sizes = except === 'sizes' ? [] : filters.sizes
  const colours = except === 'colours' ? [] : filters.colours
  const applyPrice = except !== 'price'

  const wanted = new Set(sizes.map((label) => label.toLowerCase()))
  const wantedColours = new Set(colours)

  return entry.variants.filter((variant) => {
    if (wanted.size > 0 && !wanted.has(variant.sizeLabel.toLowerCase())) return false
    if (wantedColours.size > 0 && !wantedColours.has(variant.colourSlug)) return false

    if (applyPrice) {
      if (filters.minPrice !== null && variant.pricePaise < filters.minPrice) return false
      if (filters.maxPrice !== null && variant.pricePaise > filters.maxPrice) return false
    }

    // In-stock is checked here rather than in SQL: `stockQty > reservedQty` is a field-to-field
    // comparison Payload cannot express, so the query filters coarsely and the exact figure is
    // settled against `availableQty` on the view.
    if (filters.inStockOnly && !variant.isAvailable) return false

    return true
  })
}

/** Products that match, each paired with the variants that made them match. */
export function selectEntries(
  entries: readonly CatalogEntry[],
  filters: CatalogFilters,
  except: FacetKey | null = null,
): { entry: CatalogEntry; variants: VariantView[] }[] {
  const wantedCategories = except === 'categories' ? new Set<string>() : new Set(filters.categories)

  const matched: { entry: CatalogEntry; variants: VariantView[] }[] = []

  for (const entry of entries) {
    if (wantedCategories.size > 0) {
      if (entry.categorySlug === null || !wantedCategories.has(entry.categorySlug)) continue
    }

    const variants = selectVariants(entry, filters, except)
    if (variants.length === 0) continue

    matched.push({ entry, variants })
  }

  return matched
}

/** Lowest price among a set of variants, in paise. Zero for an empty set. */
function minPriceOf(variants: readonly VariantView[]): number {
  let min = Number.POSITIVE_INFINITY
  for (const variant of variants) {
    if (variant.pricePaise < min) min = variant.pricePaise
  }
  return Number.isFinite(min) ? min : 0
}

function maxPriceOf(variants: readonly VariantView[]): number {
  let max = Number.NEGATIVE_INFINITY
  for (const variant of variants) {
    if (variant.pricePaise > max) max = variant.pricePaise
  }
  return Number.isFinite(max) ? max : 0
}

/**
 * Order the matched products.
 *
 * Price sorting happens here rather than in SQL because the price a customer sees is the
 * variant's when it has one and the product's MRP when it does not — a fallback the database
 * cannot order by without a computed column. Every comparison falls back to the title so the
 * order is total and a refresh never reshuffles equal rows.
 */
export function sortMatches<T extends { entry: CatalogEntry; variants: VariantView[] }>(
  matches: readonly T[],
  sort: CatalogSort,
): T[] {
  const byTitle = (a: T, b: T): number => a.entry.title.localeCompare(b.entry.title)

  return [...matches].sort((a, b) => {
    switch (sort) {
      case 'price_asc':
        return minPriceOf(a.variants) - minPriceOf(b.variants) || byTitle(a, b)
      case 'price_desc':
        return maxPriceOf(b.variants) - maxPriceOf(a.variants) || byTitle(a, b)
      case 'newest':
        return b.entry.createdAt.localeCompare(a.entry.createdAt) || byTitle(a, b)
      case 'relevance':
      default:
        return Number(b.entry.featured) - Number(a.entry.featured) || byTitle(a, b)
    }
  })
}

export interface Page<T> {
  items: T[]
  page: number
  pageCount: number
  total: number
  hasPrevPage: boolean
  hasNextPage: boolean
}

/**
 * Slice a page out of the matched set.
 *
 * A page number past the end returns no items rather than clamping back to the last page: the
 * URL asked for something that is not there, and quietly serving different content under it
 * would put two pages at one address.
 */
export function paginate<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE): Page<T> {
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.max(1, Math.floor(page))
  const start = (current - 1) * pageSize

  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pageCount,
    total,
    hasPrevPage: current > 1,
    hasNextPage: current < pageCount,
  }
}

function priceRangeOfMatches(
  matches: readonly { variants: VariantView[] }[],
): PriceRange {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const match of matches) {
    for (const variant of match.variants) {
      if (variant.pricePaise < min) min = variant.pricePaise
      if (variant.pricePaise > max) max = variant.pricePaise
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { minPaise: 0, maxPaise: 0 }
  return { minPaise: min, maxPaise: max }
}

/**
 * Facet values with the number of products each would return.
 *
 * Every facet is counted with the other facets applied and itself ignored, so ticking a second
 * colour widens rather than narrows and the counts stay honest. Values with a zero count are
 * still returned — a disabled option tells a customer the filter exists; a missing one does not.
 */
export function computeFacets(
  entries: readonly CatalogEntry[],
  filters: CatalogFilters,
): CatalogFacets {
  const categoryMatches = selectEntries(entries, filters, 'categories')
  const sizeMatches = selectEntries(entries, filters, 'sizes')
  const colourMatches = selectEntries(entries, filters, 'colours')
  const priceMatches = selectEntries(entries, filters, 'price')

  const categories = new Map<string, FacetValue>()
  for (const { entry } of categoryMatches) {
    if (entry.categorySlug === null) continue
    const existing = categories.get(entry.categorySlug)
    if (existing) {
      existing.count += 1
      continue
    }
    categories.set(entry.categorySlug, {
      label: entry.categoryTitle ?? entry.categorySlug,
      value: entry.categorySlug,
      count: 1,
    })
  }

  // Counting distinct products per value, not variants: "Blue (3)" means three garments,
  // not the twelve rows that back them.
  const sizes = new Map<string, FacetValue & { sortOrder: number }>()
  for (const { variants } of sizeMatches) {
    const seen = new Set<string>()
    for (const variant of variants) {
      if (seen.has(variant.sizeLabel)) continue
      seen.add(variant.sizeLabel)

      const existing = sizes.get(variant.sizeLabel)
      if (existing) {
        existing.count += 1
        continue
      }
      sizes.set(variant.sizeLabel, {
        label: variant.sizeLabel,
        value: variant.sizeLabel,
        count: 1,
        sortOrder: variant.sizeSortOrder,
      })
    }
  }

  const colours = new Map<string, FacetValue>()
  for (const { variants } of colourMatches) {
    const seen = new Set<string>()
    for (const variant of variants) {
      if (seen.has(variant.colourSlug)) continue
      seen.add(variant.colourSlug)

      const existing = colours.get(variant.colourSlug)
      if (existing) {
        existing.count += 1
        continue
      }
      colours.set(variant.colourSlug, {
        label: variant.colourName,
        value: variant.colourSlug,
        count: 1,
        hex: variant.colourHex,
      })
    }
  }

  return {
    categories: [...categories.values()].sort((a, b) => a.label.localeCompare(b.label)),
    sizes: [...sizes.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
      .map(({ sortOrder: _sortOrder, ...facet }) => facet),
    colours: [...colours.values()].sort((a, b) => a.label.localeCompare(b.label)),
    priceRange: priceRangeOfMatches(priceMatches),
  }
}
