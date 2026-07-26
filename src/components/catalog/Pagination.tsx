import Link from 'next/link'
import type { CatalogFilters } from '@/lib/catalog/types'
import { filtersToHref, withPage } from '@/lib/catalog/filters'
import { ChevronLeftIcon, ChevronRightIcon } from '../ui/icons'

/**
 * Real `<a>` links, not a client-side page-number click handler — a search engine can crawl
 * every page of the catalog, and the back button lands exactly where a customer left off.
 */

export interface PaginationProps {
  basePath: string
  filters: CatalogFilters
  page: number
  pageCount: number
}

/** A windowed page list: first, last, the current page and one neighbour either side. */
function pageWindow(page: number, pageCount: number): Array<number | 'ellipsis'> {
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1])
  const sorted = [...pages].filter((candidate) => candidate >= 1 && candidate <= pageCount).sort((a, b) => a - b)

  const result: Array<number | 'ellipsis'> = []
  let previous: number | null = null
  for (const candidate of sorted) {
    if (previous !== null && candidate - previous > 1) result.push('ellipsis')
    result.push(candidate)
    previous = candidate
  }
  return result
}

export function Pagination({ basePath, filters, page, pageCount }: PaginationProps): React.ReactElement | null {
  if (pageCount <= 1) return null

  const hasPrevPage = page > 1
  const hasNextPage = page < pageCount

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-2 pt-8">
      {hasPrevPage ? (
        <Link
          href={filtersToHref(basePath, withPage(filters, page - 1))}
          aria-label="Previous page"
          className="text-fg-muted hover:text-fg hover:bg-surface-raised flex size-9 items-center justify-center rounded-[--radius-control] transition-colors duration-fast ease-out"
        >
          <ChevronLeftIcon className="size-4" />
        </Link>
      ) : (
        <span aria-hidden="true" className="text-fg-subtle flex size-9 items-center justify-center">
          <ChevronLeftIcon className="size-4" />
        </span>
      )}

      {pageWindow(page, pageCount).map((entry, index) =>
        entry === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} aria-hidden="true" className="text-fg-subtle px-2 text-sm">
            …
          </span>
        ) : entry === page ? (
          <span
            key={entry}
            aria-current="page"
            className="bg-accent text-accent-fg flex size-9 items-center justify-center rounded-[--radius-control] text-sm font-medium"
          >
            {entry}
          </span>
        ) : (
          <Link
            key={entry}
            href={filtersToHref(basePath, withPage(filters, entry))}
            className="text-fg-muted hover:text-fg hover:bg-surface-raised flex size-9 items-center justify-center rounded-[--radius-control] text-sm transition-colors duration-fast ease-out"
          >
            {entry}
          </Link>
        ),
      )}

      {hasNextPage ? (
        <Link
          href={filtersToHref(basePath, withPage(filters, page + 1))}
          aria-label="Next page"
          className="text-fg-muted hover:text-fg hover:bg-surface-raised flex size-9 items-center justify-center rounded-[--radius-control] transition-colors duration-fast ease-out"
        >
          <ChevronRightIcon className="size-4" />
        </Link>
      ) : (
        <span aria-hidden="true" className="text-fg-subtle flex size-9 items-center justify-center">
          <ChevronRightIcon className="size-4" />
        </span>
      )}
    </nav>
  )
}
