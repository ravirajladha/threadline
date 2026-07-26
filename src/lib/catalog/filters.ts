/**
 * The URL is the listing's state.
 *
 * Nothing about a listing lives in React state: a customer who filters to navy shirts in size M
 * and then refreshes, shares the link, or presses back must land on the same grid. That only
 * works if the query string is the single source of truth, which is why this module owns both
 * directions of the conversion and no component parses a search param itself.
 *
 * Two properties earn their keep here.
 *
 * The first is that parsing is total. A query string is written by strangers — crawlers,
 * scrapers, someone editing the address bar — so every function below drops what it cannot
 * understand and returns a usable filter set. `parseFilters` never throws, because a malformed
 * URL should render the unfiltered catalog, not a 500.
 *
 * The second is that serialisation is canonical. Keys come out in a fixed order, array values
 * sorted, and anything at its default is omitted entirely. One filter set therefore has exactly
 * one URL, which is what stops `?size=S&size=M` and `?size=M&size=S` from becoming two pages
 * that Google indexes as duplicates of each other.
 *
 * Money is integer paise on both sides of the boundary. A price bound written as a float would
 * be the one place in the system where a rupee amount was allowed to drift.
 */
import {
  CATALOG_SORTS,
  DEFAULT_SORT,
  type CatalogFilters,
  type CatalogSort,
} from './types'

/** The three multi-value facets. Named so callers cannot pass a typo'd facet key. */
export type FacetName = 'categories' | 'sizes' | 'colours'

/** A facet value paired with the facet it belongs to — what the "active filters" row renders. */
export interface ActiveFacetValue {
  facet: FacetName
  value: string
}

/**
 * Caps. An unfiltered facet list is a cheap way for anyone to build an expensive query: fifty
 * thousand `size=` values become a fifty-thousand-item `IN` clause. These bounds are generous
 * next to a real catalog and cheap next to an attack.
 */
export const MAX_FACET_VALUES = 50
export const MAX_FACET_VALUE_LENGTH = 64
/** Deep pages have no customers, only crawlers. Beyond this the listing stops paginating. */
export const MAX_PAGE = 500

/** Query parameter names, which are singular because a shopper reads `?size=M`, not `?sizes=M`. */
const FACET_PARAMS: Readonly<Record<FacetName, string>> = Object.freeze({
  categories: 'category',
  sizes: 'size',
  colours: 'colour',
})

const FACET_NAMES: readonly FacetName[] = ['categories', 'sizes', 'colours']

/**
 * A slug as `slugify` produces it. Anything else cannot match a row, so dropping it keeps the
 * URL short and the query narrow rather than sending `drop table` to the database to miss.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A size label as an owner types it: `S`, `XL`, `32`, `4-5Y`, `30/32`. Deliberately looser than
 * a slug — a size is a label, not a slug, and case is part of it.
 */
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-./ ]*$/

const DIGITS_PATTERN = /^\d+$/

/** What Next hands a page as `searchParams`, plus the `URLSearchParams` a client component holds. */
export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>

function rawValues(input: SearchParamsInput, key: string): string[] {
  if (input instanceof URLSearchParams) return input.getAll(key)

  const value = input[key]
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function firstValue(input: SearchParamsInput, key: string): string | undefined {
  return rawValues(input, key)[0]
}

/**
 * Normalise one facet's raw values.
 *
 * Repeated keys (`?size=S&size=M`) and a comma-separated single value (`?size=S,M`) both arrive
 * here, because links written by hand use one form and links built by the filter rail use the
 * other, and a customer should not be able to tell which they are looking at.
 *
 * Slugs are lowercased; labels keep their case, since `4-5Y` reads wrong as `4-5y` on a pill.
 * De-duplication is case-insensitive either way, keeping the first spelling seen.
 */
function normaliseFacet(values: readonly string[], kind: 'slug' | 'label'): string[] {
  const pattern = kind === 'slug' ? SLUG_PATTERN : LABEL_PATTERN
  const seen = new Map<string, string>()

  for (const raw of values) {
    for (const token of raw.split(',')) {
      const trimmed = token.trim()
      if (trimmed.length === 0 || trimmed.length > MAX_FACET_VALUE_LENGTH) continue

      const value = kind === 'slug' ? trimmed.toLowerCase() : trimmed
      if (!pattern.test(value)) continue

      const key = value.toLowerCase()
      if (!seen.has(key)) seen.set(key, value)
    }
  }

  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_FACET_VALUES)
    .map(([, value]) => value)
}

/**
 * A price bound in paise. Digits only, so `-4`, `12.50`, `1e9999` and `0x10` all become "no
 * bound" rather than a number nobody meant. An unparseable bound widens the listing; it never
 * empties it.
 */
function parsePaise(raw: string | undefined): number | null {
  if (raw === undefined) return null

  const trimmed = raw.trim()
  if (!DIGITS_PATTERN.test(trimmed)) return null

  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

/**
 * An inverted range is a slip of the fingers, not a request for nothing. Swapping the bounds
 * shows the products between them, which is what the customer was reaching for.
 */
function orderBounds(min: number | null, max: number | null): [number | null, number | null] {
  if (min !== null && max !== null && min > max) return [max, min]
  return [min, max]
}

function isCatalogSort(value: string | undefined): value is CatalogSort {
  return CATALOG_SORTS.some((sort) => sort === value)
}

function parsePage(raw: string | undefined): number {
  if (raw === undefined) return 1

  const trimmed = raw.trim()
  if (!DIGITS_PATTERN.test(trimmed)) return 1

  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value < 1) return 1
  return Math.min(value, MAX_PAGE)
}

/** Parse a query string into filters. Total: every input produces a listing, none throws. */
export function parseFilters(input: SearchParamsInput): CatalogFilters {
  const [minPrice, maxPrice] = orderBounds(
    parsePaise(firstValue(input, 'minPrice')),
    parsePaise(firstValue(input, 'maxPrice')),
  )

  const inStock = firstValue(input, 'inStock')?.trim().toLowerCase()
  const sort = firstValue(input, 'sort')?.trim().toLowerCase()

  return {
    categories: normaliseFacet(rawValues(input, 'category'), 'slug'),
    sizes: normaliseFacet(rawValues(input, 'size'), 'label'),
    colours: normaliseFacet(rawValues(input, 'colour'), 'slug'),
    minPrice,
    maxPrice,
    inStockOnly: inStock === '1' || inStock === 'true',
    sort: isCatalogSort(sort) ? sort : DEFAULT_SORT,
    page: parsePage(firstValue(input, 'page')),
  }
}

/**
 * The canonical query string for these filters, with no leading `?`.
 *
 * Defaults are omitted rather than written out: `sort=relevance&page=1&inStock=false` describes
 * the same page as the bare category URL, and emitting it would hand a crawler two addresses
 * for one listing.
 */
export function serialiseFilters(filters: CatalogFilters): string {
  const params = new URLSearchParams()

  for (const facet of FACET_NAMES) {
    for (const value of filters[facet]) params.append(FACET_PARAMS[facet], value)
  }
  if (filters.minPrice !== null) params.append('minPrice', String(filters.minPrice))
  if (filters.maxPrice !== null) params.append('maxPrice', String(filters.maxPrice))
  if (filters.inStockOnly) params.append('inStock', '1')
  if (filters.sort !== DEFAULT_SORT) params.append('sort', filters.sort)
  if (filters.page > 1) params.append('page', String(filters.page))

  return params.toString()
}

/** `pathname` with the canonical query string appended, or bare when nothing needs saying. */
export function filtersToHref(pathname: string, filters: CatalogFilters): string {
  const query = serialiseFilters(filters)
  return query.length === 0 ? pathname : `${pathname}?${query}`
}

function normaliseOne(facet: FacetName, value: string): string | null {
  const [normalised] = normaliseFacet([value], facet === 'sizes' ? 'label' : 'slug')
  return normalised ?? null
}

function copy(filters: CatalogFilters): CatalogFilters {
  return {
    ...filters,
    categories: [...filters.categories],
    sizes: [...filters.sizes],
    colours: [...filters.colours],
  }
}

/**
 * Add a facet value, or remove it if it is already on.
 *
 * Page resets to 1. Narrowing a result set while staying on page 7 is how a customer is shown
 * an empty grid immediately after asking for something that exists.
 *
 * A value that could never match — blank, over-long, not a slug — leaves the filters alone
 * rather than being written into the URL for the database to miss.
 */
export function toggleFacet(
  filters: CatalogFilters,
  facet: FacetName,
  value: string,
): CatalogFilters {
  const next = copy(filters)
  const normalised = normaliseOne(facet, value)
  if (normalised === null) return next

  const key = normalised.toLowerCase()
  const current = next[facet]
  const without = current.filter((existing) => existing.toLowerCase() !== key)

  if (without.length < current.length) {
    next[facet] = without
    next.page = 1
    return next
  }

  if (current.length >= MAX_FACET_VALUES) return next

  next[facet] = normaliseFacet([...current, normalised], facet === 'sizes' ? 'label' : 'slug')
  next.page = 1
  return next
}

/** Whether a facet value is currently on. Case-insensitive, so a pill lights up either way. */
export function isFacetActive(filters: CatalogFilters, facet: FacetName, value: string): boolean {
  const key = value.trim().toLowerCase()
  if (key.length === 0) return false
  return filters[facet].some((existing) => existing.toLowerCase() === key)
}

/** Re-sort. Page resets because page 7 of one ordering is not page 7 of another. */
export function withSort(filters: CatalogFilters, sort: CatalogSort): CatalogFilters {
  const next = copy(filters)
  next.sort = isCatalogSort(sort) ? sort : DEFAULT_SORT
  next.page = 1
  return next
}

/** Move to a page, clamped into the range the listing will actually serve. */
export function withPage(filters: CatalogFilters, page: number): CatalogFilters {
  const next = copy(filters)
  next.page = Number.isSafeInteger(page) ? Math.min(Math.max(page, 1), MAX_PAGE) : 1
  return next
}

/** Set the price bounds in paise. Nonsense on either side becomes "unbounded", not "nothing". */
export function withPriceRange(
  filters: CatalogFilters,
  minPaise: number | null,
  maxPaise: number | null,
): CatalogFilters {
  const clean = (value: number | null): number | null =>
    value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null

  const [minPrice, maxPrice] = orderBounds(clean(minPaise), clean(maxPaise))
  const next = copy(filters)
  next.minPrice = minPrice
  next.maxPrice = maxPrice
  next.page = 1
  return next
}

/** Hide what cannot be bought. Page resets — this is the filter that shrinks a grid the most. */
export function withInStockOnly(filters: CatalogFilters, inStockOnly: boolean): CatalogFilters {
  const next = copy(filters)
  next.inStockOnly = inStockOnly
  next.page = 1
  return next
}

/**
 * "Clear all". Sort survives, because it is a preference about how the customer reads a grid
 * rather than a filter on what is in it; everything else, page included, goes back to default.
 */
export function clearFilters(filters: CatalogFilters): CatalogFilters {
  return {
    categories: [],
    sizes: [],
    colours: [],
    minPrice: null,
    maxPrice: null,
    inStockOnly: false,
    sort: filters.sort,
    page: 1,
  }
}

/** Whether anything is narrowing the catalog. Sort and page order a listing, they do not filter it. */
export function hasActiveFilters(filters: CatalogFilters): boolean {
  return (
    filters.categories.length > 0 ||
    filters.sizes.length > 0 ||
    filters.colours.length > 0 ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.inStockOnly
  )
}

/** Every active facet value, flattened in facet order — the removable chips above a grid. */
export function activeFacetValues(filters: CatalogFilters): ActiveFacetValue[] {
  return FACET_NAMES.flatMap((facet) => filters[facet].map((value) => ({ facet, value })))
}
