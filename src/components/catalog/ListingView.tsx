/**
 * The shared body of every listing page.
 *
 * `/shop` and `/c/[slug]` differ only in their heading, their crumbs and the base path their
 * filter links are built against — everything below that is the same page. Composing them from
 * one component is what keeps a filter fix from having to be made twice, and it is why
 * `basePath` is a prop rather than something read from the URL: the server already knows which
 * page it is rendering, and a component that reads the router is a component that cannot be
 * server-rendered.
 */
import type { CatalogFacets, CatalogFilters, CatalogListing, Crumb } from '@/lib/catalog/types'
import { hasActiveFilters } from '@/lib/catalog/filters'
import { ActiveFilters } from './ActiveFilters'
import { FilterRail } from './FilterRail'
import { Pagination } from './Pagination'
import { ProductGrid } from './ProductGrid'
import { SortSelect } from './SortSelect'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { EmptyState } from '@/components/ui/EmptyState'

interface ListingViewProps {
  heading: string
  intro?: string | null
  crumbs: Crumb[]
  filters: CatalogFilters
  facets: CatalogFacets
  listing: CatalogListing
  basePath: string
}

export function ListingView({
  heading,
  intro,
  crumbs,
  filters,
  facets,
  listing,
  basePath,
}: ListingViewProps) {
  const isFiltered = hasActiveFilters(filters)

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-12">
      <Breadcrumbs crumbs={crumbs} />

      <header className="mt-4 flex flex-col gap-2">
        <h1 className="text-fg text-3xl font-medium tracking-tight md:text-4xl">{heading}</h1>
        {intro ? <p className="text-fg-muted max-w-prose text-base">{intro}</p> : null}
      </header>

      <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:gap-12">
        <FilterRail facets={facets} filters={filters} basePath={basePath} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-fg-muted text-sm" aria-live="polite">
              {listing.totalProducts === 1 ? '1 product' : `${listing.totalProducts} products`}
            </p>
            <SortSelect filters={filters} basePath={basePath} />
          </div>

          <ActiveFilters filters={filters} facets={facets} basePath={basePath} />

          {listing.products.length === 0 ? (
            <EmptyState
              title={isFiltered ? 'Nothing matches those filters' : 'Nothing here yet'}
              description={
                isFiltered
                  ? 'Try removing a filter — sizes and colours narrow the results quickly.'
                  : 'New pieces are on their way. Check back shortly.'
              }
            />
          ) : (
            <>
              <ProductGrid products={listing.products} />
              <Pagination
                page={listing.page}
                pageCount={listing.pageCount}
                filters={filters}
                basePath={basePath}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
