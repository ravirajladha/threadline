/**
 * Filters into Payload queries.
 *
 * Listings are fetched in two phases, and the reason is worth writing down because the single
 * joined query that replaces them looks obviously better and is wrong.
 *
 * A shopper filtering to "size M" and "blue" means *this product is available in M and comes in
 * blue*. Expressed as one query over products joined to their variants, the conditions land on
 * the same joined row and the database is asked for a variant that is simultaneously M and blue
 * — which is a stricter question, and quietly hides a shirt stocked in blue L and white M. So
 * phase one asks the variants collection which rows match the facets, phase two takes the
 * distinct product ids that come back and paginates products by them. Pagination belongs to the
 * product query because a page is twenty-four products, never twenty-four variants.
 *
 * `needsVariantQuery` exists so the first phase is skipped when nothing about the filters
 * concerns a variant — a bare category listing is one query, not two.
 *
 * Every builder here produces a `Where` and nothing else. No function in this module talks to a
 * database, which is what makes the query shape a thing a unit test can assert.
 */
import type { Where } from 'payload'

import { PAGE_SIZE, type CatalogFilters, type CatalogSort } from './types'

/**
 * Postgres identity columns start at 1, so no row ever has id 0. This is the "match nothing"
 * clause, used when a variant phase ran and returned no products: an empty `id: { in: [] }` is
 * liable to be treated as an absent constraint, and "no results" silently becoming "all
 * results" is the worst failure this module could have.
 */
const IMPOSSIBLE_ID = 0

const MATCHES_NOTHING: Where = { id: { equals: IMPOSSIBLE_ID } }

/**
 * Whether the facets say anything about variants.
 *
 * Category, sort and page are product-level; size, colour, price and stock are not. Only the
 * latter need the variant phase.
 */
export function needsVariantQuery(filters: CatalogFilters): boolean {
  return (
    filters.sizes.length > 0 ||
    filters.colours.length > 0 ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.inStockOnly
  )
}

/**
 * Phase one: the variants that match the facets.
 *
 * `isActive` is always constrained — a deactivated variant is a row the owner has taken off
 * sale, and it must not pull its product into a listing.
 *
 * In-stock is coarse on purpose. "Available" is `stockQty − reservedQty`, and Payload has no
 * field-to-field comparison, so the SQL filter can only be `stockQty > 0` and the exact
 * subtraction happens in the view layer where both numbers are in hand. Do not "fix" this to
 * compare against a literal: a variant with 3 in stock and 3 reserved is sold out, and only
 * `variantView` can know that.
 *
 * Price is coarse for a different reason. A variant with no `price` of its own inherits the
 * product MRP, which is not visible from the variants collection, so a bounded query cannot
 * decide whether such a row qualifies. It therefore matches variants whose own price is in
 * range *or* which have no price at all, and the caller re-filters precisely with
 * `resolveVariantPricePaise` once the product is loaded. The trade is a few extra rows read in
 * exchange for never dropping a product that was in the customer's range all along.
 */
export function buildVariantWhere(filters: CatalogFilters): Where {
  const clauses: Where[] = [{ isActive: { equals: true } }]

  if (filters.sizes.length > 0) clauses.push({ 'size.label': { in: filters.sizes } })
  if (filters.colours.length > 0) clauses.push({ 'colour.slug': { in: filters.colours } })
  if (filters.inStockOnly) clauses.push({ stockQty: { greater_than: 0 } })

  const bounds: { greater_than_equal?: number; less_than_equal?: number } = {}
  if (filters.minPrice !== null) bounds.greater_than_equal = filters.minPrice
  if (filters.maxPrice !== null) bounds.less_than_equal = filters.maxPrice
  if (filters.minPrice !== null || filters.maxPrice !== null) {
    clauses.push({ or: [{ price: bounds }, { price: { exists: false } }] })
  }

  return { and: clauses }
}

/**
 * Phase two: the products a listing actually pages through.
 *
 * `status: active` is unconditional. A draft or archived product must not be reachable from a
 * listing whatever the filters say (OWASP A05), so the constraint is added first and no branch
 * below can remove it.
 *
 * `productIds` is the result of phase one: `null` when no variant phase ran and products must
 * not be constrained by id, an empty array when the phase ran and matched nothing.
 */
export function buildProductWhere(filters: CatalogFilters, productIds: number[] | null): Where {
  const clauses: Where[] = [{ status: { equals: 'active' } }]

  if (filters.categories.length > 0) {
    clauses.push({ 'category.slug': { in: filters.categories } })
  }

  if (productIds !== null) {
    clauses.push(productIds.length > 0 ? { id: { in: productIds } } : MATCHES_NOTHING)
  }

  return { and: clauses }
}

/**
 * The `sort` string Payload is given.
 *
 * `price_asc` and `price_desc` are missing on purpose. Price is not a product field — it lives
 * on the variant, and a product's card price is the minimum across its variants after the MRP
 * fallback has been applied. The database cannot order by a number it does not hold, so both
 * price sorts return a stable `title` here and the caller orders the resolved card views by
 * `priceRange.minPaise` afterwards.
 *
 * `relevance` is `-featured`: the catalog's own order, with what the owner promoted first.
 */
export function buildSortString(sort: CatalogSort): string {
  switch (sort) {
    case 'newest':
      return '-createdAt'
    case 'price_asc':
    case 'price_desc':
      return 'title'
    case 'relevance':
      return '-featured'
    default:
      return '-featured'
  }
}

/** Page size is a technical constant, not an owner setting — see the contract. */
export function paginationOf(filters: CatalogFilters): { limit: number; page: number } {
  const page = Number.isSafeInteger(filters.page) ? Math.max(filters.page, 1) : 1
  return { limit: PAGE_SIZE, page }
}

/**
 * What a variant actually sells for.
 *
 * The single place the MRP fallback is expressed. A variant sets `price` only when it differs
 * from the product's — a size that costs more to make, say — so an absent price is the normal
 * case and means "the product's". Zero is a real price and inherits nothing.
 */
export function resolveVariantPricePaise(
  variant: { price?: number | null },
  productMrpPaise: number,
): number {
  return variant.price ?? productMrpPaise
}
