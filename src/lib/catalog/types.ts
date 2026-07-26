/**
 * The catalog contract.
 *
 * Everything the storefront renders passes through one of these shapes. They exist as a
 * separate module — rather than being inferred from whatever a query happened to return —
 * for two reasons.
 *
 * First, these views cross the server → client boundary, so they are plain serialisable data:
 * no methods, no `Money` instances, no Payload documents with populated relationships hanging
 * off them. Paise stay integers until a component formats them.
 *
 * Second, they are the seam. `CatalogPort` is the interface the pages depend on; Payload sits
 * behind it in `payloadCatalog.ts`. A test builds a fixture, not a database.
 */
import type { SizeGroup } from '@/types'

/** How a listing is ordered. `relevance` is the default and means the catalog's own order. */
export const CATALOG_SORTS = ['relevance', 'price_asc', 'price_desc', 'newest'] as const
export type CatalogSort = (typeof CATALOG_SORTS)[number]

export const DEFAULT_SORT: CatalogSort = 'relevance'

/** Products per listing page. A technical default, not an owner-facing setting. */
export const PAGE_SIZE = 24

/**
 * A listing's state, parsed from the URL.
 *
 * Arrays are sorted and de-duplicated so that one filter set has exactly one canonical URL —
 * `?size=M&size=S` and `?size=S&size=M` are the same page and must not be two of them.
 */
export interface CatalogFilters {
  /** Category slugs. Empty means every category. */
  categories: string[]
  /** Size labels as they appear on the pill: `S`, `32`, `4-5Y`. */
  sizes: string[]
  /** Colour slugs. */
  colours: string[]
  /** Inclusive price bounds in paise. `null` means unbounded on that side. */
  minPrice: number | null
  maxPrice: number | null
  /** Hide anything with nothing left to sell. */
  inStockOnly: boolean
  sort: CatalogSort
  /** 1-based. Never zero or negative. */
  page: number
}

export const EMPTY_FILTERS: Readonly<CatalogFilters> = Object.freeze({
  categories: [],
  sizes: [],
  colours: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
  sort: DEFAULT_SORT,
  page: 1,
})

/** An image, already resolved to a URL. `colourId` is null for untagged gallery entries. */
export interface ImageView {
  id: number
  url: string
  alt: string
  width: number | null
  height: number | null
  colourId: number | null
}

/** A colour swatch on a card or a product page. */
export interface SwatchView {
  id: number
  name: string
  slug: string
  hex: string
  /** False when every variant in this colour is sold out — shown, never hidden. */
  isAvailable: boolean
}

/**
 * One sellable row, flattened.
 *
 * `availableQty` is `stockQty − reservedQty` floored at zero: a negative figure is a data
 * problem, not something a customer should ever be shown or be able to order against.
 */
export interface VariantView {
  id: number
  sku: string
  sizeId: number
  sizeLabel: string
  sizeSortOrder: number
  colourId: number
  colourName: string
  colourSlug: string
  colourHex: string
  /** Variant price when set, product MRP otherwise. Paise. */
  pricePaise: number
  compareAtPricePaise: number | null
  availableQty: number
  isAvailable: boolean
}

/**
 * A size pill for the selected colour.
 *
 * A sold-out size still gets a pill — DESIGN.md §5. `variantId` is null when the product has
 * no row at all for that size in this colour, which reads the same to a customer but must not
 * be added to a cart.
 */
export interface SizePillView {
  sizeId: number
  label: string
  sortOrder: number
  variantId: number | null
  availableQty: number
  isAvailable: boolean
  /** Drives "Only 2 left". */
  isLow: boolean
}

/** Price span across a product's variants. Equal bounds render as a single price. */
export interface PriceRange {
  minPaise: number
  maxPaise: number
}

/** What a grid cell needs. Deliberately small — a listing page builds dozens of these. */
export interface ProductCardView {
  id: number
  title: string
  slug: string
  categorySlug: string | null
  image: ImageView | null
  /** Second image, revealed on hover. Null when the product has only one. */
  hoverImage: ImageView | null
  priceRange: PriceRange
  /** Highest compare-at across variants, for the strike-through. */
  compareAtPricePaise: number | null
  swatches: SwatchView[]
  isSoldOut: boolean
  /** Total units left when that total is low enough to be worth saying. */
  lowStockQty: number | null
}

export interface SizeChartRowView {
  sizeLabel: string
  chestIn: number | null
  waistIn: number | null
  lengthIn: number | null
  shoulderIn: number | null
}

export interface SizeChartView {
  title: string
  group: SizeGroup
  rows: SizeChartRowView[]
  notes: string | null
}

/** Lexical rich text, passed through opaquely. Rendered by the Payload serialiser, never raw. */
export type RichText = Record<string, unknown> | null

export interface SeoView {
  title: string
  description: string | null
  ogImageUrl: string | null
  /** Absolute-path canonical, e.g. `/p/oxford-shirt`. */
  canonicalPath: string
}

export interface ProductDetailView {
  id: number
  title: string
  slug: string
  description: RichText
  fabric: string | null
  careInstructions: string | null
  fitNotes: string | null
  taxRatePct: number
  mrpPaise: number
  categoryId: number | null
  categoryTitle: string | null
  categorySlug: string | null
  sizeChart: SizeChartView | null
  /** Every image, in gallery order. Filter per colour with `galleryFor`. */
  images: ImageView[]
  swatches: SwatchView[]
  /** First colour with stock, falling back to the first swatch. Null when there are none. */
  defaultColourId: number | null
  variants: VariantView[]
  priceRange: PriceRange
  compareAtPricePaise: number | null
  seo: SeoView
  updatedAt: string
}

export interface Crumb {
  title: string
  /** Absolute path, or null for the current page — the last crumb is not a link. */
  href: string | null
}

export interface CategoryView {
  id: number
  title: string
  slug: string
  description: RichText
  sizeGroup: SizeGroup
  parentId: number | null
  image: ImageView | null
  seo: SeoView
  sortOrder: number
}

/** A facet value with the count of products that match it, for the filter rail. */
export interface FacetValue {
  label: string
  value: string
  count: number
  /** Colour facets carry their swatch colour; size and category facets do not. */
  hex?: string
}

export interface CatalogFacets {
  categories: FacetValue[]
  sizes: FacetValue[]
  colours: FacetValue[]
  priceRange: PriceRange
}

export interface CatalogListing {
  products: ProductCardView[]
  page: number
  pageCount: number
  totalProducts: number
  hasPrevPage: boolean
  hasNextPage: boolean
}

/**
 * Everything the storefront asks of the catalog.
 *
 * Pages depend on this interface, never on Payload directly. CLAUDE.md §3: program to
 * interfaces — swapping the data source or mocking it in a test is one new class.
 */
export interface CatalogPort {
  listProducts(filters: CatalogFilters): Promise<CatalogListing>
  getFacets(filters: CatalogFilters): Promise<CatalogFacets>
  getProductBySlug(slug: string): Promise<ProductDetailView | null>
  getCategoryBySlug(slug: string): Promise<CategoryView | null>
  /** Every active category, for the nav and the filter rail. */
  listCategories(): Promise<CategoryView[]>
  /** Ancestor chain for a category, root first, the category itself last. Cycle-safe. */
  getCategoryAncestors(categoryId: number): Promise<CategoryView[]>
  getFeaturedProducts(limit: number): Promise<ProductCardView[]>
}
