/**
 * `/c/[slug]` — a category listing.
 *
 * A category means the category *and everything under it*: opening "Men" and being shown an
 * empty page because the garments live in "Men → Topwear → Shirts" is the tree leaking into the
 * shopfront. So the listing is scoped to the whole subtree, and a category filter arriving in
 * the URL is intersected with that subtree rather than replacing it — a hand-edited query string
 * is not a way to show another section's stock under this page's heading.
 *
 * An unknown or deactivated slug is a 404, not an empty grid.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ListingView } from '@/components/catalog/ListingView'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildCrumbs } from '@/lib/catalog/breadcrumbs'
import { scopeCategoryFilter } from '@/lib/catalog/categoryTree'
import { parseFilters } from '@/lib/catalog/filters'
import { getCatalog } from '@/lib/catalog/server'
import { breadcrumbJsonLd } from '@/lib/seo/jsonLd'
import { categoryMetadata } from '@/lib/seo/metadata'

type Params = Promise<{ slug: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}): Promise<Metadata> {
  const { slug } = await params
  const category = await (await getCatalog()).getCategoryBySlug(slug)
  if (!category) return { title: 'Not found', robots: { index: false, follow: false } }

  return categoryMetadata(category, parseFilters(await searchParams))
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { slug } = await params
  const catalog = await getCatalog()

  const category = await catalog.getCategoryBySlug(slug)
  if (!category) notFound()

  const requested = parseFilters(await searchParams)
  const categories = await catalog.listCategories()
  const filters = {
    ...requested,
    categories: scopeCategoryFilter(categories, category.id, requested.categories),
  }

  const [listing, facets, ancestors] = await Promise.all([
    catalog.listProducts(filters),
    catalog.getFacets(filters),
    catalog.getCategoryAncestors(category.id),
  ])

  const crumbs = buildCrumbs(ancestors)

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <ListingView
        heading={category.title}
        crumbs={crumbs}
        filters={filters}
        facets={facets}
        listing={listing}
        basePath={`/c/${category.slug}`}
      />
    </>
  )
}
