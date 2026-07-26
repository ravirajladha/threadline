'use client'
// Interactive: navigates to the new sort order as soon as it changes.

import { useId } from 'react'
import { useRouter } from 'next/navigation'
import { CATALOG_SORTS, type CatalogFilters, type CatalogSort } from '@/lib/catalog/types'
import { filtersToHref, withSort } from '@/lib/catalog/filters'
import { ChevronDownIcon } from '../ui/icons'

const SORT_LABELS: Record<CatalogSort, string> = {
  relevance: 'Featured',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  newest: 'Newest',
}

export interface SortSelectProps {
  filters: CatalogFilters
  basePath: string
}

export function SortSelect({ filters, basePath }: SortSelectProps): React.ReactElement {
  const router = useRouter()
  const labelId = useId()

  return (
    <div className="inline-flex items-center gap-2">
      <label id={labelId} htmlFor={`${labelId}-select`} className="text-fg-muted text-sm">
        Sort by
      </label>
      <div className="relative">
        <select
          id={`${labelId}-select`}
          value={filters.sort}
          onChange={(event) => {
            router.push(filtersToHref(basePath, withSort(filters, event.target.value as CatalogSort)))
          }}
          className="border-border bg-surface text-fg rounded-[--radius-control] border py-2 pr-8 pl-3 text-sm appearance-none"
        >
          {CATALOG_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="text-fg-muted pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2" />
      </div>
    </div>
  )
}
