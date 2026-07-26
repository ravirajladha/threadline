/**
 * The Payload-backed implementation of `CatalogPort`.
 *
 * This file is the only place in the storefront that knows Payload exists. Pages depend on the
 * interface; swapping the data source or building a page against a fixture is a different class,
 * not an edit to every route.
 *
 * **Why it loads the catalog rather than querying per request.** A clothing listing filters on
 * facts that live on the *variant* — size, colour, availability, and a price that falls back to
 * the product's MRP when the variant does not set one. SQL cannot express "this product has a
 * blue variant in M" as a single joined predicate without either a subquery per facet or a
 * denormalised table, and it cannot order by a price that does not exist as a column. So the
 * catalog is read once per request and the rules run over it in `select.ts`, where they are pure
 * and tested.
 *
 * That is a deliberate trade, and it has a ceiling: it is right for a catalog in the hundreds of
 * products and wrong in the tens of thousands. The seam is `loadCatalogIndex` — when the catalog
 * outgrows this, that one function becomes a materialised facet table and nothing above it moves.
 * J9 revisits it with real numbers. React's `cache` keeps it to one load per request in the
 * meantime, so a page that renders a grid, a filter rail and a breadcrumb trail still reads once.
 */
import { cache } from 'react'
import type { Payload, Where } from 'payload'

import type { Category, Media, Product, SizeChart } from '@/payload-types'
import { categoryAncestry } from './breadcrumbs'
import { toImageViews } from './gallery'
import { toProductCardView, toProductDetailView } from './productView'
import { toVariantViews } from './variantView'
import { computeFacets, paginate, selectEntries, sortMatches, type CatalogEntry } from './select'
import type {
  CatalogFacets,
  CatalogFilters,
  CatalogListing,
  CatalogPort,
  CategoryView,
  ImageView,
  ProductCardView,
  ProductDetailView,
  SeoView,
} from './types'

/**
 * Nothing draft or archived, ever.
 *
 * The `products` collection is publicly readable — staff need to preview unpublished work — so
 * this constraint is what keeps an unfinished product off the storefront (OWASP A05). It is
 * applied in every read below without exception, including the by-slug lookup: a draft product
 * whose slug leaked must 404, not render.
 */
const PUBLISHED: Where = { status: { equals: 'active' } }

// --- Mapping ----------------------------------------------------------------

function isPopulatedMedia(value: unknown): value is Media {
  return typeof value === 'object' && value !== null && 'url' in value
}

function mediaToImageView(value: unknown, fallbackAlt: string): ImageView | null {
  if (!isPopulatedMedia(value)) return null
  if (typeof value.url !== 'string' || value.url.length === 0) return null

  return {
    id: value.id,
    url: value.url,
    alt: value.alt.length > 0 ? value.alt : fallbackAlt,
    width: value.width ?? null,
    height: value.height ?? null,
    colourId: null,
  }
}

function categorySeo(category: Category): SeoView {
  return {
    title: category.seo?.title ?? category.title,
    description: category.seo?.description ?? null,
    ogImageUrl: mediaToImageView(category.seo?.ogImage, category.title)?.url ?? null,
    canonicalPath: `/c/${category.slug}`,
  }
}

function toCategoryView(category: Category): CategoryView {
  return {
    id: category.id,
    title: category.title,
    slug: category.slug,
    description: category.description ?? null,
    sizeGroup: category.sizeGroup,
    parentId: typeof category.parent === 'object' && category.parent !== null
      ? category.parent.id
      : (category.parent ?? null),
    image: mediaToImageView(category.image, category.title),
    seo: categorySeo(category),
    sortOrder: category.sortOrder ?? 0,
  }
}

function categoryOf(product: Product): Category | null {
  return typeof product.category === 'object' && product.category !== null ? product.category : null
}

// --- The index --------------------------------------------------------------

/**
 * Every published product with its variants and images, normalised into view models.
 *
 * Two queries rather than one nested read: Payload's `depth` would populate each variant's
 * product all over again, and a catalog of 76 variants would arrive as 76 copies of six products.
 */
const loadCatalogIndex = cache(async (payload: Payload): Promise<CatalogEntry[]> => {
  const { docs: products } = await payload.find({
    collection: 'products',
    where: PUBLISHED,
    depth: 2,
    pagination: false,
    overrideAccess: true,
  })

  if (products.length === 0) return []

  const { docs: variants } = await payload.find({
    collection: 'variants',
    where: {
      isActive: { equals: true },
      product: { in: products.map((product) => product.id) },
    },
    depth: 1,
    pagination: false,
    overrideAccess: true,
  })

  const byProduct = new Map<number, unknown[]>()
  for (const variant of variants) {
    const productId = typeof variant.product === 'object' ? variant.product.id : variant.product
    const bucket = byProduct.get(productId)
    if (bucket) bucket.push(variant)
    else byProduct.set(productId, [variant])
  }

  return products.map((product) => {
    const category = categoryOf(product)

    return {
      id: product.id,
      title: product.title,
      slug: product.slug,
      featured: product.featured ?? false,
      createdAt: product.createdAt,
      categoryId: category?.id ?? null,
      categoryTitle: category?.title ?? null,
      categorySlug: category?.slug ?? null,
      variants: toVariantViews(byProduct.get(product.id) ?? [], product.mrp),
      images: toImageViews(product.gallery, product.title),
      product,
    }
  })
})

function entryToCard(entry: CatalogEntry): ProductCardView {
  // The card is rebuilt from the entry rather than cached on it: a listing's swatches and
  // "only N left" reflect the *filtered* variants, so they cannot be computed once up front.
  return toProductCardView(entry.product, entry.variants, entry.images)
}

// --- The port ---------------------------------------------------------------

export function createPayloadCatalog(payload: Payload): CatalogPort {
  return {
    async listProducts(filters: CatalogFilters): Promise<CatalogListing> {
      const entries = await loadCatalogIndex(payload)
      const matched = sortMatches(selectEntries(entries, filters), filters.sort)
      const page = paginate(matched, filters.page)

      return {
        products: page.items.map(({ entry, variants }) =>
          entryToCard({ ...entry, variants }),
        ),
        page: page.page,
        pageCount: page.pageCount,
        totalProducts: page.total,
        hasPrevPage: page.hasPrevPage,
        hasNextPage: page.hasNextPage,
      }
    },

    async getFacets(filters: CatalogFilters): Promise<CatalogFacets> {
      return computeFacets(await loadCatalogIndex(payload), filters)
    },

    async getProductBySlug(slug: string): Promise<ProductDetailView | null> {
      const { docs } = await payload.find({
        collection: 'products',
        where: { and: [PUBLISHED, { slug: { equals: slug } }] },
        depth: 2,
        limit: 1,
        overrideAccess: true,
      })

      const product = docs[0]
      if (!product) return null

      const { docs: variants } = await payload.find({
        collection: 'variants',
        where: { isActive: { equals: true }, product: { equals: product.id } },
        depth: 1,
        pagination: false,
        overrideAccess: true,
      })

      const category = categoryOf(product)

      return toProductDetailView({
        product,
        variants,
        images: toImageViews(product.gallery, product.title),
        category,
        sizeChart: await resolveSizeChart(payload, category),
      })
    },

    async getCategoryBySlug(slug: string): Promise<CategoryView | null> {
      const { docs } = await payload.find({
        collection: 'categories',
        where: { isActive: { equals: true }, slug: { equals: slug } },
        depth: 1,
        limit: 1,
        overrideAccess: true,
      })

      const category = docs[0]
      return category ? toCategoryView(category) : null
    },

    async listCategories(): Promise<CategoryView[]> {
      const { docs } = await payload.find({
        collection: 'categories',
        where: { isActive: { equals: true } },
        depth: 1,
        pagination: false,
        sort: 'sortOrder',
        overrideAccess: true,
      })

      return docs.map(toCategoryView)
    },

    async getCategoryAncestors(categoryId: number): Promise<CategoryView[]> {
      return categoryAncestry(await this.listCategories(), categoryId)
    },

    async getFeaturedProducts(limit: number): Promise<ProductCardView[]> {
      const entries = await loadCatalogIndex(payload)

      return entries
        .filter((entry) => entry.featured && entry.variants.length > 0)
        .slice(0, Math.max(0, limit))
        .map(entryToCard)
    },
  }
}

/**
 * A category's size chart, fetched only when `depth` left it as an id.
 *
 * Depth 2 populates it for most reads, but a category nested under a parent can come back one
 * level short, and a missing size chart on a product page is a returns problem rather than a
 * rendering one — so it is worth the extra read when it happens.
 */
async function resolveSizeChart(
  payload: Payload,
  category: Category | null,
): Promise<SizeChart | null> {
  if (!category?.sizeChart) return null
  if (typeof category.sizeChart === 'object') return category.sizeChart

  try {
    return await payload.findByID({
      collection: 'sizeCharts',
      id: category.sizeChart,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    // A deleted chart must not take the product page down with it.
    return null
  }
}
