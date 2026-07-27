'use client'
// Interactive: every chip and the "Clear all" action navigates to a new filter state.

import { useRouter } from 'next/navigation'
import type { CatalogFacets, CatalogFilters, FacetValue } from '@/lib/catalog/types'
import {
  activeFacetValues,
  clearFilters,
  filtersToHref,
  hasActiveFilters,
  toggleFacet,
  withInStockOnly,
  withPriceRange,
  type FacetName,
} from '@/lib/catalog/filters'
import { CloseIcon } from '../ui/icons'

const FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

/** One removable chip, and the action that clears it. */
interface Chip {
  key: string
  label: string
  remove: (filters: CatalogFilters) => CatalogFilters
}

function labelFor(facets: CatalogFacets, facet: FacetName, value: string): string {
  const values: FacetValue[] = facets[facet]
  return values.find((candidate) => candidate.value === value)?.label ?? value
}

export interface ActiveFiltersProps {
  filters: CatalogFilters
  facets: CatalogFacets
  basePath: string
}

export function ActiveFilters({ filters, facets, basePath }: ActiveFiltersProps): React.ReactElement | null {
  const router = useRouter()

  if (!hasActiveFilters(filters)) return null

  const chips: Chip[] = activeFacetValues(filters).map(({ facet, value }) => ({
    key: `${facet}-${value}`,
    label: labelFor(facets, facet, value),
    remove: (current) => toggleFacet(current, facet, value),
  }))

  if (filters.minPrice !== null || filters.maxPrice !== null) {
    const label =
      filters.minPrice !== null && filters.maxPrice !== null
        ? `${FORMATTER.format(filters.minPrice / 100)} – ${FORMATTER.format(filters.maxPrice / 100)}`
        : filters.minPrice !== null
          ? `Over ${FORMATTER.format(filters.minPrice / 100)}`
          : `Under ${FORMATTER.format((filters.maxPrice ?? 0) / 100)}`
    chips.push({ key: 'price', label, remove: (current) => withPriceRange(current, null, null) })
  }

  if (filters.inStockOnly) {
    chips.push({ key: 'inStock', label: 'In stock only', remove: (current) => withInStockOnly(current, false) })
  }

  const removeChip = (chip: Chip): void => {
    router.push(filtersToHref(basePath, chip.remove(filters)))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => removeChip(chip)}
          className="bg-surface-raised text-fg hover:bg-border inline-flex items-center gap-2 rounded-control py-1.5 pr-2 pl-3 text-sm transition-colors duration-fast ease-out"
        >
          {chip.label}
          <CloseIcon className="size-3.5" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => router.push(filtersToHref(basePath, clearFilters(filters)))}
        className="text-fg-muted hover:text-fg px-2 py-1.5 text-sm underline-offset-2 hover:underline"
      >
        Clear all
      </button>
    </div>
  )
}
