import { describe, expect, it } from 'vitest'

import {
  computeFacets,
  paginate,
  selectEntries,
  selectVariants,
  sortMatches,
  type CatalogEntry,
} from '@/lib/catalog/select'
import type { Product } from '@/payload-types'
import { EMPTY_FILTERS, type CatalogFilters, type VariantView } from '@/lib/catalog/types'

// --- Fixtures ---------------------------------------------------------------

const SIZES = { S: 1, M: 2, L: 3 } as const
const COLOURS = {
  blue: { id: 10, name: 'Indigo', slug: 'indigo', hex: '#1b2a4a' },
  ecru: { id: 11, name: 'Ecru', slug: 'ecru', hex: '#efe7d8' },
} as const

let nextVariantId = 100

function variant(
  sizeLabel: keyof typeof SIZES,
  colour: keyof typeof COLOURS,
  pricePaise: number,
  availableQty = 5,
): VariantView {
  const c = COLOURS[colour]
  return {
    id: nextVariantId++,
    sku: `SKU-${c.slug}-${sizeLabel}`,
    sizeId: SIZES[sizeLabel],
    sizeLabel,
    sizeSortOrder: SIZES[sizeLabel],
    colourId: c.id,
    colourName: c.name,
    colourSlug: c.slug,
    colourHex: c.hex,
    pricePaise,
    compareAtPricePaise: null,
    availableQty,
    isAvailable: availableQty > 0,
  }
}

function product(id: number, title: string, slug: string): Product {
  return {
    id,
    title,
    slug,
    category: 1,
    mrp: 149900,
    taxRatePct: 5,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function entry(overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'title'>): CatalogEntry {
  const slug = overrides.slug ?? overrides.title.toLowerCase().replace(/\s+/g, '-')

  return {
    slug,
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    categoryId: 1,
    categoryTitle: 'Shirts',
    categorySlug: 'shirts',
    variants: [],
    images: [],
    product: product(overrides.id, overrides.title, slug),
    ...overrides,
  }
}

function filters(overrides: Partial<CatalogFilters> = {}): CatalogFilters {
  return { ...EMPTY_FILTERS, ...overrides }
}

const oxford = entry({
  id: 1,
  title: 'Oxford Shirt',
  featured: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  variants: [
    variant('S', 'blue', 149900),
    variant('M', 'blue', 149900),
    variant('M', 'ecru', 149900, 0),
    variant('L', 'ecru', 159900),
  ],
})

const tee = entry({
  id: 2,
  title: 'Everyday Tee',
  createdAt: '2026-05-01T00:00:00.000Z',
  categoryId: 2,
  categoryTitle: 'T-shirts',
  categorySlug: 't-shirts',
  variants: [variant('S', 'ecru', 49900), variant('M', 'ecru', 49900, 0)],
})

const CATALOG = [oxford, tee]

// --- selectVariants ---------------------------------------------------------

describe('selectVariants', () => {
  it('returns everything when no facet is set', () => {
    expect(selectVariants(oxford, filters())).toHaveLength(4)
  })

  it('applies size and colour to the same variant, not to the product', () => {
    // The product has an M and it has an ecru, but the pair must both hold on one row.
    const blueLarge = selectVariants(oxford, filters({ sizes: ['L'], colours: ['indigo'] }))
    expect(blueLarge).toHaveLength(0)

    const ecruLarge = selectVariants(oxford, filters({ sizes: ['L'], colours: ['ecru'] }))
    expect(ecruLarge).toHaveLength(1)
  })

  it('matches size labels case-insensitively', () => {
    expect(selectVariants(oxford, filters({ sizes: ['m'] }))).toHaveLength(2)
  })

  it('treats price bounds as inclusive', () => {
    expect(selectVariants(oxford, filters({ minPrice: 149900, maxPrice: 149900 }))).toHaveLength(3)
  })

  it('drops sold-out rows only when in-stock is asked for', () => {
    expect(selectVariants(oxford, filters())).toHaveLength(4)
    expect(selectVariants(oxford, filters({ inStockOnly: true }))).toHaveLength(3)
  })

  it('ignores the facet it is told to except', () => {
    const narrowed = filters({ colours: ['indigo'] })
    expect(selectVariants(oxford, narrowed)).toHaveLength(2)
    expect(selectVariants(oxford, narrowed, 'colours')).toHaveLength(4)
  })
})

// --- selectEntries ----------------------------------------------------------

describe('selectEntries', () => {
  it('keeps only products with a surviving variant', () => {
    const matched = selectEntries(CATALOG, filters({ sizes: ['L'] }))
    expect(matched.map((m) => m.entry.id)).toEqual([1])
  })

  it('filters by category slug', () => {
    const matched = selectEntries(CATALOG, filters({ categories: ['t-shirts'] }))
    expect(matched.map((m) => m.entry.id)).toEqual([2])
  })

  it('returns nothing when a category matches no product', () => {
    expect(selectEntries(CATALOG, filters({ categories: ['knitwear'] }))).toEqual([])
  })

  it('drops a product whose only matching variants are sold out', () => {
    const matched = selectEntries(CATALOG, filters({ sizes: ['M'], inStockOnly: true }))
    // The tee's only M is sold out; the shirt still has a blue M.
    expect(matched.map((m) => m.entry.id)).toEqual([1])
  })

  it('carries the surviving variants alongside the product', () => {
    const [match] = selectEntries(CATALOG, filters({ colours: ['indigo'] }))
    expect(match?.variants.every((v) => v.colourSlug === 'indigo')).toBe(true)
  })
})

// --- sortMatches ------------------------------------------------------------

describe('sortMatches', () => {
  const matches = selectEntries(CATALOG, filters())

  it('puts featured first for relevance', () => {
    expect(sortMatches(matches, 'relevance').map((m) => m.entry.id)).toEqual([1, 2])
  })

  it('sorts by the cheapest surviving variant ascending', () => {
    expect(sortMatches(matches, 'price_asc').map((m) => m.entry.id)).toEqual([2, 1])
  })

  it('sorts by the dearest surviving variant descending', () => {
    expect(sortMatches(matches, 'price_desc').map((m) => m.entry.id)).toEqual([1, 2])
  })

  it('sorts newest first', () => {
    expect(sortMatches(matches, 'newest').map((m) => m.entry.id)).toEqual([2, 1])
  })

  it('does not mutate its input', () => {
    const before = matches.map((m) => m.entry.id)
    sortMatches(matches, 'price_asc')
    expect(matches.map((m) => m.entry.id)).toEqual(before)
  })

  it('breaks ties on title so the order never wobbles', () => {
    const a = { entry: entry({ id: 3, title: 'Beta' }), variants: [variant('S', 'ecru', 1000)] }
    const b = { entry: entry({ id: 4, title: 'Alpha' }), variants: [variant('S', 'ecru', 1000)] }
    expect(sortMatches([a, b], 'price_asc').map((m) => m.entry.title)).toEqual(['Alpha', 'Beta'])
  })
})

// --- paginate ---------------------------------------------------------------

describe('paginate', () => {
  const items = Array.from({ length: 7 }, (_, i) => i + 1)

  it('slices the requested page', () => {
    expect(paginate(items, 2, 3)).toMatchObject({
      items: [4, 5, 6],
      page: 2,
      pageCount: 3,
      total: 7,
      hasPrevPage: true,
      hasNextPage: true,
    })
  })

  it('reports a single empty page for an empty set', () => {
    expect(paginate([], 1, 3)).toMatchObject({
      items: [],
      pageCount: 1,
      total: 0,
      hasPrevPage: false,
      hasNextPage: false,
    })
  })

  it('returns nothing past the end rather than clamping to the last page', () => {
    // Clamping would serve the last page's content under a URL that asked for another one.
    expect(paginate(items, 9, 3).items).toEqual([])
  })

  it('floors a page below one', () => {
    expect(paginate(items, 0, 3).page).toBe(1)
  })
})

// --- computeFacets ----------------------------------------------------------

describe('computeFacets', () => {
  it('counts distinct products, not variants', () => {
    const facets = computeFacets(CATALOG, filters())
    expect(facets.colours.find((c) => c.value === 'ecru')?.count).toBe(2)
    expect(facets.sizes.find((s) => s.value === 'M')?.count).toBe(2)
  })

  it('does not count a facet against itself', () => {
    // Having ticked Indigo, the count beside Ecru must still answer "what if I tick this too".
    const facets = computeFacets(CATALOG, filters({ colours: ['indigo'] }))
    expect(facets.colours.find((c) => c.value === 'ecru')?.count).toBe(2)
  })

  it('does narrow one facet by another', () => {
    const facets = computeFacets(CATALOG, filters({ categories: ['t-shirts'] }))
    expect(facets.colours.map((c) => c.value)).toEqual(['ecru'])
  })

  it('orders sizes by their sort order, not alphabetically', () => {
    expect(computeFacets(CATALOG, filters()).sizes.map((s) => s.value)).toEqual(['S', 'M', 'L'])
  })

  it('carries the swatch colour on colour facets only', () => {
    const facets = computeFacets(CATALOG, filters())
    expect(facets.colours.every((c) => typeof c.hex === 'string')).toBe(true)
    expect(facets.sizes.every((s) => s.hex === undefined)).toBe(true)
  })

  it('reports the price range ignoring the price filter', () => {
    const facets = computeFacets(CATALOG, filters({ minPrice: 100000 }))
    expect(facets.priceRange).toEqual({ minPaise: 49900, maxPaise: 159900 })
  })

  it('reports a zero range when nothing matches', () => {
    const facets = computeFacets(CATALOG, filters({ categories: ['knitwear'] }))
    expect(facets.priceRange).toEqual({ minPaise: 0, maxPaise: 0 })
  })
})
