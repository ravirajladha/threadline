import type { Where } from 'payload'
import { describe, expect, it } from 'vitest'

import {
  buildProductWhere,
  buildSortString,
  buildVariantWhere,
  needsVariantQuery,
  paginationOf,
  resolveVariantPricePaise,
} from '@/lib/catalog/query'
import { DEFAULT_SORT, PAGE_SIZE, type CatalogFilters, type CatalogSort } from '@/lib/catalog/types'

const BASE: CatalogFilters = {
  categories: [],
  sizes: [],
  colours: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
  sort: DEFAULT_SORT,
  page: 1,
}

function filters(overrides: Partial<CatalogFilters>): CatalogFilters {
  return { ...BASE, ...overrides }
}

/** The `and` clauses of a where, so a test can assert on one constraint at a time. */
function clausesOf(where: Where): Where[] {
  const { and } = where
  if (!Array.isArray(and)) throw new Error('Expected the where to be an `and` of clauses')
  return and
}

describe('needsVariantQuery', () => {
  const cases: [string, CatalogFilters, boolean][] = [
    ['nothing', BASE, false],
    ['a category', filters({ categories: ['shirts'] }), false],
    ['a sort', filters({ sort: 'newest' }), false],
    ['a page', filters({ page: 3 }), false],
    ['a size', filters({ sizes: ['M'] }), true],
    ['a colour', filters({ colours: ['navy'] }), true],
    ['a lower price bound', filters({ minPrice: 0 }), true],
    ['an upper price bound', filters({ maxPrice: 100000 }), true],
    ['in-stock only', filters({ inStockOnly: true }), true],
  ]

  it.each(cases)('with %s it is %s', (_label, given, expected) => {
    // A bare category listing is one query, not two.
    expect(needsVariantQuery(given)).toBe(expected)
  })
})

describe('buildVariantWhere', () => {
  it('always constrains isActive, even with no filters at all', () => {
    expect(buildVariantWhere(BASE)).toEqual({ and: [{ isActive: { equals: true } }] })
  })

  it('matches sizes by label', () => {
    expect(clausesOf(buildVariantWhere(filters({ sizes: ['M', 'S'] })))).toContainEqual({
      'size.label': { in: ['M', 'S'] },
    })
  })

  it('matches colours by slug', () => {
    expect(clausesOf(buildVariantWhere(filters({ colours: ['ecru', 'navy'] })))).toContainEqual({
      'colour.slug': { in: ['ecru', 'navy'] },
    })
  })

  it('filters in-stock coarsely on stockQty alone', () => {
    // Payload cannot compare two fields, so `stockQty − reservedQty` is settled in the view
    // layer. A variant with 3 in stock and 3 reserved passes this clause and is filtered out
    // later — do not "fix" this to a tighter literal.
    expect(clausesOf(buildVariantWhere(filters({ inStockOnly: true })))).toContainEqual({
      stockQty: { greater_than: 0 },
    })
  })

  it('leaves stock unconstrained when the filter is off', () => {
    expect(JSON.stringify(buildVariantWhere(BASE))).not.toContain('stockQty')
  })

  it('ORs an unpriced variant into a lower-bounded query', () => {
    // A variant without its own price inherits the product MRP, which is not visible from the
    // variants collection — so it is read and re-checked rather than dropped here.
    expect(clausesOf(buildVariantWhere(filters({ minPrice: 99900 })))).toContainEqual({
      or: [{ price: { greater_than_equal: 99900 } }, { price: { exists: false } }],
    })
  })

  it('ORs an unpriced variant into an upper-bounded query', () => {
    expect(clausesOf(buildVariantWhere(filters({ maxPrice: 249900 })))).toContainEqual({
      or: [{ price: { less_than_equal: 249900 } }, { price: { exists: false } }],
    })
  })

  it('combines both bounds into one clause', () => {
    const where = buildVariantWhere(filters({ minPrice: 99900, maxPrice: 249900 }))
    expect(clausesOf(where)).toContainEqual({
      or: [
        { price: { greater_than_equal: 99900, less_than_equal: 249900 } },
        { price: { exists: false } },
      ],
    })
    expect(clausesOf(where)).toHaveLength(2)
  })

  it('treats a zero lower bound as a real bound', () => {
    expect(JSON.stringify(buildVariantWhere(filters({ minPrice: 0 })))).toContain(
      'greater_than_equal',
    )
  })

  it('carries every facet at once', () => {
    const where = buildVariantWhere(
      filters({
        sizes: ['M'],
        colours: ['navy'],
        minPrice: 100000,
        maxPrice: 500000,
        inStockOnly: true,
        categories: ['shirts'],
      }),
    )
    // Category is product-level and must not appear on the variant query.
    expect(clausesOf(where)).toEqual([
      { isActive: { equals: true } },
      { 'size.label': { in: ['M'] } },
      { 'colour.slug': { in: ['navy'] } },
      { stockQty: { greater_than: 0 } },
      {
        or: [
          { price: { greater_than_equal: 100000, less_than_equal: 500000 } },
          { price: { exists: false } },
        ],
      },
    ])
  })
})

describe('buildProductWhere', () => {
  const everyFilterSet = filters({
    categories: ['shirts'],
    sizes: ['M'],
    colours: ['navy'],
    minPrice: 1,
    maxPrice: 2,
    inStockOnly: true,
    sort: 'newest',
    page: 4,
  })

  const alwaysActive: [string, CatalogFilters, number[] | null][] = [
    ['no filters', BASE, null],
    ['a category', filters({ categories: ['shirts'] }), null],
    ['matching ids', BASE, [1, 2, 3]],
    ['no matching ids', BASE, []],
    ['every filter set', everyFilterSet, [7]],
  ]

  it.each(alwaysActive)('constrains status to active with %s', (_label, given, ids) => {
    // A draft or archived product must never be reachable from a listing (OWASP A05).
    expect(clausesOf(buildProductWhere(given, ids))).toContainEqual({
      status: { equals: 'active' },
    })
  })

  it('does not constrain by id when no variant phase ran', () => {
    expect(buildProductWhere(BASE, null)).toEqual({ and: [{ status: { equals: 'active' } }] })
  })

  it('matches categories by slug', () => {
    expect(buildProductWhere(filters({ categories: ['shirts', 'tees'] }), null)).toEqual({
      and: [{ status: { equals: 'active' } }, { 'category.slug': { in: ['shirts', 'tees'] } }],
    })
  })

  it('constrains to the ids the variant phase returned', () => {
    expect(clausesOf(buildProductWhere(BASE, [4, 9, 11]))).toContainEqual({
      id: { in: [4, 9, 11] },
    })
  })

  it('matches nothing when the variant phase returned nothing', () => {
    // The classic bug this guards: an empty id list read as an absent constraint, so "no
    // results" quietly becomes "every product".
    const where = buildProductWhere(filters({ sizes: ['M'] }), [])
    expect(clausesOf(where)).toEqual([{ status: { equals: 'active' } }, { id: { equals: 0 } }])
  })

  it('still matches nothing when a category is also filtered', () => {
    const where = buildProductWhere(filters({ categories: ['shirts'], sizes: ['M'] }), [])
    expect(clausesOf(where)).toContainEqual({ id: { equals: 0 } })
  })

  it('combines category and ids', () => {
    expect(buildProductWhere(filters({ categories: ['shirts'] }), [2])).toEqual({
      and: [
        { status: { equals: 'active' } },
        { 'category.slug': { in: ['shirts'] } },
        { id: { in: [2] } },
      ],
    })
  })
})

describe('buildSortString', () => {
  const cases: [CatalogSort, string][] = [
    ['relevance', '-featured'],
    ['newest', '-createdAt'],
    ['price_asc', 'title'],
    ['price_desc', 'title'],
  ]

  it.each(cases)('sorts %s by %s', (sort, expected) => {
    expect(buildSortString(sort)).toBe(expected)
  })

  it('falls back to the catalog order for a value that is not a sort', () => {
    // Typed as CatalogSort at the boundary, but this is the last line before a query string
    // reaches the database, so an unknown value orders the listing rather than breaking it.
    const rogue = 'cheapest-first' as unknown as CatalogSort
    expect(buildSortString(rogue)).toBe('-featured')
  })

  it('does not ask the database to order by a field it does not hold', () => {
    // Price lives on the variant; the caller re-orders the resolved card views afterwards.
    expect(buildSortString('price_asc')).not.toContain('price')
    expect(buildSortString('price_desc')).not.toContain('price')
  })
})

describe('paginationOf', () => {
  it('uses the contract page size', () => {
    expect(paginationOf(BASE)).toEqual({ limit: PAGE_SIZE, page: 1 })
  })

  it('passes the requested page through', () => {
    expect(paginationOf(filters({ page: 7 }))).toEqual({ limit: PAGE_SIZE, page: 7 })
  })

  it.each([0, -3, 1.5, Number.NaN])('floors a page of %j at 1', (page) => {
    expect(paginationOf(filters({ page })).page).toBe(1)
  })
})

describe('resolveVariantPricePaise', () => {
  it('uses the variant price when it has one', () => {
    expect(resolveVariantPricePaise({ price: 189900 }, 249900)).toBe(189900)
  })

  it('inherits the product MRP when the variant has no price', () => {
    expect(resolveVariantPricePaise({}, 249900)).toBe(249900)
  })

  it.each([null, undefined])('inherits the MRP for a price of %j', (price) => {
    expect(resolveVariantPricePaise({ price }, 249900)).toBe(249900)
  })

  it('treats zero as a real price, not as missing', () => {
    expect(resolveVariantPricePaise({ price: 0 }, 249900)).toBe(0)
  })
})
