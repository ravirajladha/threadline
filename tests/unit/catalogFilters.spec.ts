import { describe, expect, it } from 'vitest'

import {
  MAX_FACET_VALUES,
  MAX_FACET_VALUE_LENGTH,
  MAX_PAGE,
  activeFacetValues,
  clearFilters,
  filtersToHref,
  hasActiveFilters,
  isFacetActive,
  parseFilters,
  serialiseFilters,
  toggleFacet,
  withInStockOnly,
  withPage,
  withPriceRange,
  withSort,
  type FacetName,
} from '@/lib/catalog/filters'
import { DEFAULT_SORT, type CatalogFilters } from '@/lib/catalog/types'

/** Parse a raw query string the way a page would, via `URLSearchParams`. */
function parse(query: string): CatalogFilters {
  return parseFilters(new URLSearchParams(query))
}

/** A deep copy to compare against, so a mutation in a builder cannot hide behind a reference. */
function snapshotOf(filters: CatalogFilters): CatalogFilters {
  return JSON.parse(JSON.stringify(filters)) as CatalogFilters
}

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

describe('parseFilters — defaults', () => {
  it('returns the unfiltered catalog for an empty query', () => {
    expect(parse('')).toEqual(BASE)
  })

  it('accepts the record shape a server component receives as searchParams', () => {
    expect(parseFilters({ category: 'shirts', size: ['S', 'M'], page: '2' })).toEqual({
      ...BASE,
      categories: ['shirts'],
      sizes: ['M', 'S'],
      page: 2,
    })
  })

  it('ignores an undefined value in the record shape', () => {
    expect(parseFilters({ category: undefined, sort: undefined })).toEqual(BASE)
  })
})

describe('parseFilters — facets', () => {
  it('reads a repeated key', () => {
    expect(parse('size=S&size=M').sizes).toEqual(['M', 'S'])
  })

  it('reads a comma-separated value', () => {
    expect(parse('size=S,M').sizes).toEqual(['M', 'S'])
  })

  it('reads both forms in one query', () => {
    expect(parse('size=S,M&size=L').sizes).toEqual(['L', 'M', 'S'])
  })

  it('sorts and de-duplicates', () => {
    expect(parse('colour=navy&colour=ecru&colour=navy').colours).toEqual(['ecru', 'navy'])
  })

  it('lowercases slugs', () => {
    expect(parse('category=Shirts&colour=Midnight-Navy')).toMatchObject({
      categories: ['shirts'],
      colours: ['midnight-navy'],
    })
  })

  it('preserves the case of a size label', () => {
    // `4-5y` on a pill reads as a bug to every parent who sees it.
    expect(parse('size=XL&size=4-5Y').sizes).toEqual(['4-5Y', 'XL'])
  })

  it('de-duplicates sizes case-insensitively, keeping the first spelling', () => {
    expect(parse('size=XL&size=xl').sizes).toEqual(['XL'])
    expect(parse('size=xl&size=XL').sizes).toEqual(['xl'])
  })

  it('trims surrounding whitespace', () => {
    expect(parse('size=%20M%20,%20L%20').sizes).toEqual(['L', 'M'])
  })

  it('caps the number of values per facet', () => {
    const many = Array.from({ length: MAX_FACET_VALUES + 20 }, (_, i) => `c${i}`).join(',')
    expect(parse(`colour=${many}`).colours).toHaveLength(MAX_FACET_VALUES)
  })

  it('drops a value longer than the cap', () => {
    const long = 'a'.repeat(MAX_FACET_VALUE_LENGTH + 1)
    expect(parse(`colour=${long}&colour=navy`).colours).toEqual(['navy'])
  })

  it('keeps a value exactly at the length cap', () => {
    const atCap = 'a'.repeat(MAX_FACET_VALUE_LENGTH)
    expect(parse(`colour=${atCap}`).colours).toEqual([atCap])
  })
})

describe('parseFilters — untrusted input', () => {
  it.each([
    ['?page=-4', 'page=-4'],
    ['?page=abc', 'page=abc'],
    ['?page=0', 'page=0'],
    ['?page=1.5', 'page=1.5'],
    ['?sort=DROP TABLE', 'sort=DROP+TABLE'],
    ['?sort=', 'sort='],
    ['?minPrice=1e9999', 'minPrice=1e9999'],
    ['?minPrice=-100', 'minPrice=-100'],
    ['?minPrice=12.50', 'minPrice=12.50'],
    ['?minPrice=0x10', 'minPrice=0x10'],
    ['?size= (empty)', 'size='],
    ['?colours[]=x', 'colours%5B%5D=x'],
    ['?category=<script>', 'category=%3Cscript%3E'],
    ['?colour=drop table', 'colour=drop+table'],
    ['a 500-character colour', `colour=${'z'.repeat(500)}`],
    ['a repeated unknown key', 'nope=1&nope=2'],
  ])('drops %s silently', (_label, query) => {
    expect(() => parse(query)).not.toThrow()
    expect(parse(query)).toEqual(BASE)
  })

  it('never throws for a stack of nonsense at once', () => {
    const query =
      'page=-4&sort=%00&minPrice=NaN&maxPrice=Infinity&inStock=maybe&size=&colour=%25%25&category=,,,'
    expect(parse(query)).toEqual(BASE)
  })

  it('falls back to the default sort for an unknown value', () => {
    expect(parse('sort=cheapest').sort).toBe(DEFAULT_SORT)
  })

  it.each(['relevance', 'price_asc', 'price_desc', 'newest'])('accepts sort=%s', (sort) => {
    expect(parse(`sort=${sort}`).sort).toBe(sort)
  })

  it('caps the page a crawler can walk to', () => {
    expect(parse('page=9999999').page).toBe(MAX_PAGE)
  })

  it.each([
    ['1', true],
    ['true', true],
    ['TRUE', true],
    ['0', false],
    ['false', false],
    ['yes', false],
    ['', false],
  ])('reads inStock=%s as %s', (raw, expected) => {
    expect(parse(`inStock=${raw}`).inStockOnly).toBe(expected)
  })
})

describe('parseFilters — prices', () => {
  it('reads integer paise', () => {
    expect(parse('minPrice=99900&maxPrice=249900')).toMatchObject({
      minPrice: 99900,
      maxPrice: 249900,
    })
  })

  it('accepts zero as a lower bound', () => {
    expect(parse('minPrice=0').minPrice).toBe(0)
  })

  it('swaps an inverted range rather than returning an empty listing', () => {
    expect(parse('minPrice=500000&maxPrice=100000')).toMatchObject({
      minPrice: 100000,
      maxPrice: 500000,
    })
  })

  it('keeps a bound when only one side is given', () => {
    expect(parse('maxPrice=150000')).toMatchObject({ minPrice: null, maxPrice: 150000 })
  })

  it('drops one bad bound without losing the good one', () => {
    expect(parse('minPrice=-1&maxPrice=150000')).toMatchObject({
      minPrice: null,
      maxPrice: 150000,
    })
  })
})

describe('serialiseFilters', () => {
  it('emits nothing for the default listing', () => {
    expect(serialiseFilters(BASE)).toBe('')
  })

  it('omits every default rather than spelling it out', () => {
    // sort=relevance&page=1&inStock=false describes the same page as the bare URL, and
    // emitting it would hand a crawler two addresses for one listing.
    expect(serialiseFilters({ ...BASE, sort: DEFAULT_SORT, page: 1, inStockOnly: false })).toBe('')
  })

  it('emits keys in a fixed order', () => {
    const filters: CatalogFilters = {
      categories: ['shirts'],
      sizes: ['M'],
      colours: ['navy'],
      minPrice: 100000,
      maxPrice: 500000,
      inStockOnly: true,
      sort: 'newest',
      page: 3,
    }
    expect(serialiseFilters(filters)).toBe(
      'category=shirts&size=M&colour=navy&minPrice=100000&maxPrice=500000&inStock=1&sort=newest&page=3',
    )
  })

  it('repeats the key for a multi-value facet', () => {
    expect(serialiseFilters({ ...BASE, sizes: ['L', 'M', 'S'] })).toBe('size=L&size=M&size=S')
  })

  it('gives one filter set exactly one URL, whatever order it was written in', () => {
    const a = parse('size=M&size=S&colour=navy&colour=ecru')
    const b = parse('colour=ecru&size=S&colour=navy&size=M')
    expect(serialiseFilters(a)).toBe(serialiseFilters(b))
  })

  it.each([
    ['size=S,M', 'size=M&size=S'],
    ['colour=NAVY&colour=navy', 'colour=navy'],
    ['page=1&sort=relevance&inStock=0', ''],
    ['minPrice=900&maxPrice=100', 'minPrice=100&maxPrice=900'],
  ])('canonicalises %s to %s', (input, expected) => {
    expect(serialiseFilters(parse(input))).toBe(expected)
  })
})

describe('round trip', () => {
  it.each([
    '',
    'category=shirts',
    'size=M&size=S',
    'colour=navy&colour=ecru&size=XL',
    'minPrice=99900',
    'maxPrice=249900',
    'minPrice=99900&maxPrice=249900',
    'inStock=1',
    'sort=price_asc',
    'sort=newest&page=4',
    'category=shirts&size=4-5Y&colour=navy&minPrice=0&maxPrice=999900&inStock=1&sort=price_desc&page=7',
  ])('parse(serialise(parse(%s))) is stable', (query) => {
    const once = parse(query)
    expect(parse(serialiseFilters(once))).toEqual(once)
  })

  it('is stable through an href as well', () => {
    const filters = parse('category=shirts&size=M&sort=newest&page=2')
    const href = filtersToHref('/shop', filters)
    expect(href).toBe('/shop?category=shirts&size=M&sort=newest&page=2')
    expect(parse(href.slice(href.indexOf('?')))).toEqual(filters)
  })
})

describe('filtersToHref', () => {
  it('returns the bare path when nothing needs saying', () => {
    expect(filtersToHref('/c/shirts', BASE)).toBe('/c/shirts')
  })

  it('appends the canonical query otherwise', () => {
    expect(filtersToHref('/c/shirts', { ...BASE, page: 2 })).toBe('/c/shirts?page=2')
  })
})

describe('toggleFacet', () => {
  it('adds a value that was not there', () => {
    expect(toggleFacet(BASE, 'sizes', 'M').sizes).toEqual(['M'])
  })

  it('removes a value that was', () => {
    expect(toggleFacet({ ...BASE, sizes: ['M', 'S'] }, 'sizes', 'M').sizes).toEqual(['S'])
  })

  it('keeps the list sorted as it grows', () => {
    expect(toggleFacet({ ...BASE, sizes: ['S'] }, 'sizes', 'M').sizes).toEqual(['M', 'S'])
  })

  it('removes case-insensitively', () => {
    expect(toggleFacet({ ...BASE, sizes: ['XL'] }, 'sizes', 'xl').sizes).toEqual([])
  })

  it('lowercases a slug facet on the way in', () => {
    expect(toggleFacet(BASE, 'colours', 'Midnight-Navy').colours).toEqual(['midnight-navy'])
  })

  it('preserves the case of a size label on the way in', () => {
    expect(toggleFacet(BASE, 'sizes', '4-5Y').sizes).toEqual(['4-5Y'])
  })

  it.each([
    ['blank', '   '],
    ['not a slug', 'drop table'],
    ['over-long', 'a'.repeat(MAX_FACET_VALUE_LENGTH + 1)],
  ])('leaves the filters alone for a %s value', (_label, value) => {
    const filters: CatalogFilters = { ...BASE, colours: ['navy'], page: 3 }
    expect(toggleFacet(filters, 'colours', value)).toEqual(filters)
  })

  it('refuses to grow a facet past the cap', () => {
    const full = Array.from({ length: MAX_FACET_VALUES }, (_, i) => `c${i}`).sort()
    const filters: CatalogFilters = { ...BASE, colours: full }
    expect(toggleFacet(filters, 'colours', 'navy').colours).toEqual(full)
  })

  const pageResetCases: [FacetName, string][] = [
    ['categories', 'shirts'],
    ['sizes', 'M'],
    ['colours', 'navy'],
  ]

  it.each(pageResetCases)('resets the page when %s changes', (facet, value) => {
    // Narrowing to three products while sitting on page 7 shows an empty grid.
    expect(toggleFacet({ ...BASE, page: 7 }, facet, value).page).toBe(1)
  })

  it('resets the page when a value is removed too', () => {
    expect(toggleFacet({ ...BASE, sizes: ['M'], page: 5 }, 'sizes', 'M').page).toBe(1)
  })

  it('does not mutate its input', () => {
    const filters: CatalogFilters = { ...BASE, sizes: ['S'], page: 4 }
    const snapshot = snapshotOf(filters)
    const next = toggleFacet(filters, 'sizes', 'M')
    expect(filters).toEqual(snapshot)
    expect(next).not.toBe(filters)
    expect(next.sizes).not.toBe(filters.sizes)
  })
})

describe('isFacetActive', () => {
  const filters: CatalogFilters = { ...BASE, categories: ['shirts'], sizes: ['XL'] }

  const cases: [FacetName, string, boolean][] = [
    ['categories', 'shirts', true],
    ['categories', 'SHIRTS', true],
    ['categories', 'trousers', false],
    ['sizes', 'xl', true],
    ['sizes', 'XL', true],
    ['sizes', 'M', false],
    ['colours', 'navy', false],
  ]

  it.each(cases)('%s / %s is %s', (facet, value, expected) => {
    expect(isFacetActive(filters, facet, value)).toBe(expected)
  })

  it('is false for a blank value', () => {
    expect(isFacetActive(filters, 'sizes', '  ')).toBe(false)
  })
})

describe('withSort · withPage · withPriceRange · withInStockOnly', () => {
  it('sets the sort and resets the page', () => {
    const next = withSort({ ...BASE, page: 6 }, 'price_asc')
    expect(next).toMatchObject({ sort: 'price_asc', page: 1 })
  })

  it.each([
    [3, 3],
    [0, 1],
    [-2, 1],
    [1.5, 1],
    [Number.NaN, 1],
    [9999999, MAX_PAGE],
  ])('withPage(%j) gives page %i', (page, expected) => {
    expect(withPage(BASE, page).page).toBe(expected)
  })

  it('withPage leaves every other field alone', () => {
    const filters: CatalogFilters = { ...BASE, sizes: ['M'], sort: 'newest', inStockOnly: true }
    expect(withPage(filters, 3)).toEqual({ ...filters, page: 3 })
  })

  it('sets a price range and resets the page', () => {
    expect(withPriceRange({ ...BASE, page: 9 }, 100000, 500000)).toMatchObject({
      minPrice: 100000,
      maxPrice: 500000,
      page: 1,
    })
  })

  it.each([
    [-1, 500000, null, 500000],
    [1.5, null, null, null],
    [500000, 100000, 100000, 500000],
    [null, null, null, null],
  ])('withPriceRange(%j, %j) gives (%j, %j)', (min, max, expectedMin, expectedMax) => {
    expect(withPriceRange(BASE, min, max)).toMatchObject({
      minPrice: expectedMin,
      maxPrice: expectedMax,
    })
  })

  it('sets the in-stock flag and resets the page', () => {
    expect(withInStockOnly({ ...BASE, page: 4 }, true)).toMatchObject({
      inStockOnly: true,
      page: 1,
    })
  })

  const builders: [string, (f: CatalogFilters) => CatalogFilters][] = [
    ['withSort', (f) => withSort(f, 'newest')],
    ['withPage', (f) => withPage(f, 2)],
    ['withPriceRange', (f) => withPriceRange(f, 1, 2)],
    ['withInStockOnly', (f) => withInStockOnly(f, true)],
    ['clearFilters', (f) => clearFilters(f)],
  ]

  it.each(builders)('%s returns a new object and does not mutate its input', (_label, apply) => {
    const filters: CatalogFilters = {
      ...BASE,
      categories: ['shirts'],
      sizes: ['M'],
      colours: ['navy'],
      minPrice: 1000,
      maxPrice: 2000,
      inStockOnly: false,
      sort: 'price_desc',
      page: 5,
    }
    const snapshot = snapshotOf(filters)
    const next = apply(filters)
    expect(filters).toEqual(snapshot)
    expect(next).not.toBe(filters)
    expect(next.categories).not.toBe(filters.categories)
  })
})

describe('clearFilters', () => {
  it('keeps the sort and resets everything else, page included', () => {
    const filters: CatalogFilters = {
      categories: ['shirts'],
      sizes: ['M'],
      colours: ['navy'],
      minPrice: 1000,
      maxPrice: 2000,
      inStockOnly: true,
      sort: 'price_desc',
      page: 8,
    }
    expect(clearFilters(filters)).toEqual({ ...BASE, sort: 'price_desc' })
  })

  it('serialises to just the sort', () => {
    expect(serialiseFilters(clearFilters(parse('category=shirts&sort=newest&page=3')))).toBe(
      'sort=newest',
    )
  })
})

describe('hasActiveFilters', () => {
  const cases: [string, CatalogFilters, boolean][] = [
    ['nothing', BASE, false],
    ['a sort', { ...BASE, sort: 'newest' }, false],
    ['a page', { ...BASE, page: 4 }, false],
    ['a category', { ...BASE, categories: ['shirts'] }, true],
    ['a size', { ...BASE, sizes: ['M'] }, true],
    ['a colour', { ...BASE, colours: ['navy'] }, true],
    ['a lower price bound', { ...BASE, minPrice: 0 }, true],
    ['an upper price bound', { ...BASE, maxPrice: 100 }, true],
    ['in-stock only', { ...BASE, inStockOnly: true }, true],
  ]

  it.each(cases)('with %s it is %s', (_label, filters, expected) => {
    expect(hasActiveFilters(filters)).toBe(expected)
  })
})

describe('activeFacetValues', () => {
  it('flattens every facet in facet order', () => {
    const filters = parse('colour=navy&size=M&size=S&category=shirts')
    expect(activeFacetValues(filters)).toEqual([
      { facet: 'categories', value: 'shirts' },
      { facet: 'sizes', value: 'M' },
      { facet: 'sizes', value: 'S' },
      { facet: 'colours', value: 'navy' },
    ])
  })

  it('is empty when nothing is on', () => {
    expect(activeFacetValues({ ...BASE, sort: 'newest', page: 3 })).toEqual([])
  })

  it('round trips back through toggleFacet to the empty listing', () => {
    const filters = parse('category=shirts&size=M&colour=navy')
    const cleared = activeFacetValues(filters).reduce(
      (acc, { facet, value }) => toggleFacet(acc, facet, value),
      filters,
    )
    expect(hasActiveFilters(cleared)).toBe(false)
  })
})
