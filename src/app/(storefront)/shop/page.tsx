/**
 * `/shop` — the whole catalog, filterable.
 *
 * Filters arrive as search params and are parsed, never trusted: `parseFilters` drops anything
 * it does not recognise rather than throwing, so a hand-edited or truncated URL renders a
 * listing instead of an error page. Everything the grid shows — price, availability, swatches —
 * is read server-side from the database; nothing about what is in stock is taken from the query
 * string (OWASP A04).
 */
import type { Metadata } from 'next'

import { ListingView } from '@/components/catalog/ListingView'
import { JsonLd } from '@/components/seo/JsonLd'
import { parseFilters } from '@/lib/catalog/filters'
import { getCatalog } from '@/lib/catalog/server'
import { breadcrumbJsonLd } from '@/lib/seo/jsonLd'
import { listingMetadata } from '@/lib/seo/metadata'
import type { Crumb } from '@/lib/catalog/types'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const CRUMBS: Crumb[] = [
  { title: 'Home', href: '/' },
  { title: 'Shop', href: null },
]

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams
}): Promise<Metadata> {
  return listingMetadata(parseFilters(await searchParams))
}

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams)
  const catalog = await getCatalog()

  const [listing, facets] = await Promise.all([
    catalog.listProducts(filters),
    catalog.getFacets(filters),
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(CRUMBS)} />
      <ListingView
        heading="Shop all"
        intro="Every piece in the collection."
        crumbs={CRUMBS}
        filters={filters}
        facets={facets}
        listing={listing}
        basePath="/shop"
      />
    </>
  )
}
