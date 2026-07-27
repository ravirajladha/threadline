'use client'
// Interactive: every facet control writes straight to the URL; the sheet's own open state and
// the price inputs' in-progress text are the only things kept locally.

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogFacets, CatalogFilters, FacetValue } from '@/lib/catalog/types'
import {
  filtersToHref,
  isFacetActive,
  toggleFacet,
  withInStockOnly,
  withPriceRange,
  type FacetName,
} from '@/lib/catalog/filters'
import { Modal } from '../ui/Modal'
import { ChevronDownIcon, FilterIcon } from '../ui/icons'

type ChoiceFacet = FacetName

export interface FilterRailProps {
  facets: CatalogFacets
  filters: CatalogFilters
  basePath: string
}

function FacetSection({
  title,
  facet,
  values,
  filters,
  onToggle,
}: {
  title: string
  facet: ChoiceFacet
  values: FacetValue[]
  filters: CatalogFilters
  onToggle: (facet: ChoiceFacet, value: string) => void
}): React.ReactElement | null {
  if (values.length === 0) return null

  return (
    <details open className="group border-border border-b py-4 first:pt-0">
      <summary className="text-fg flex cursor-pointer list-none items-center justify-between text-sm font-medium">
        {title}
        <ChevronDownIcon className="size-4 transition-transform duration-fast ease-out group-open:rotate-180" />
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {values.map((value) => {
          const checked = isFacetActive(filters, facet, value.value)
          return (
            <li key={value.value}>
              <label className="text-fg-muted hover:text-fg flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(facet, value.value)}
                  className="accent-accent size-4"
                />
                {value.hex ? (
                  <span
                    className="border-border-strong size-3.5 shrink-0 rounded-full border"
                    style={{ backgroundColor: value.hex }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="flex-1">{value.label}</span>
                <span className="text-fg-subtle">{value.count}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function PriceSection({
  filters,
  onApply,
}: {
  filters: CatalogFilters
  onApply: (minPaise: number | null, maxPaise: number | null) => void
}): React.ReactElement {
  // Half-typed input is local — it becomes a filter only on submit. Re-seeding it from the URL
  // is a remount, driven by the `key` this is rendered with, rather than an effect writing over
  // state React has just rendered.
  const [minValue, setMinValue] = useState(filters.minPrice !== null ? String(filters.minPrice / 100) : '')
  const [maxValue, setMaxValue] = useState(filters.maxPrice !== null ? String(filters.maxPrice / 100) : '')
  const minId = useId()
  const maxId = useId()

  return (
    <div className="border-border border-b py-4">
      <p className="text-fg text-sm font-medium">Price</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const min = minValue.trim() === '' ? null : Number(minValue)
          const max = maxValue.trim() === '' ? null : Number(maxValue)
          onApply(
            min !== null && Number.isFinite(min) ? Math.round(min * 100) : null,
            max !== null && Number.isFinite(max) ? Math.round(max * 100) : null,
          )
        }}
        className="mt-3 flex items-end gap-2"
      >
        <label className="flex flex-1 flex-col gap-2">
          <span id={minId} className="text-fg-subtle text-xs">
            Min ₹
          </span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            aria-labelledby={minId}
            value={minValue}
            onChange={(event) => setMinValue(event.target.value)}
            className="border-border bg-surface text-fg w-full rounded-control border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col gap-2">
          <span id={maxId} className="text-fg-subtle text-xs">
            Max ₹
          </span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            aria-labelledby={maxId}
            value={maxValue}
            onChange={(event) => setMaxValue(event.target.value)}
            className="border-border bg-surface text-fg w-full rounded-control border px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="border-border-strong text-fg hover:bg-surface-raised rounded-control border px-3 py-1.5 text-sm transition-colors duration-fast ease-out"
        >
          Go
        </button>
      </form>
    </div>
  )
}

function RailContents({
  facets,
  filters,
  onToggle,
  onPriceApply,
  onInStockChange,
}: {
  facets: CatalogFacets
  filters: CatalogFilters
  onToggle: (facet: ChoiceFacet, value: string) => void
  onPriceApply: (minPaise: number | null, maxPaise: number | null) => void
  onInStockChange: (inStockOnly: boolean) => void
}): React.ReactElement {
  return (
    <div className="flex flex-col">
      <FacetSection title="Category" facet="categories" values={facets.categories} filters={filters} onToggle={onToggle} />
      <FacetSection title="Size" facet="sizes" values={facets.sizes} filters={filters} onToggle={onToggle} />
      <FacetSection title="Colour" facet="colours" values={facets.colours} filters={filters} onToggle={onToggle} />
      <PriceSection key={`${filters.minPrice}-${filters.maxPrice}`} filters={filters} onApply={onPriceApply} />
      <label className="text-fg flex cursor-pointer items-center gap-2 py-4 text-sm">
        <input
          type="checkbox"
          checked={filters.inStockOnly}
          onChange={(event) => onInStockChange(event.target.checked)}
          className="accent-accent size-4"
        />
        In stock only
      </label>
    </div>
  )
}

/**
 * A desktop rail and a mobile bottom sheet sharing one set of controls — DESIGN.md asks for
 * both, and a filter rail duplicated into two implementations is exactly the kind of drift
 * CLAUDE.md's DRY rule exists to prevent.
 */
export function FilterRail({ facets, filters, basePath }: FilterRailProps): React.ReactElement {
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)

  const navigate = (next: CatalogFilters): void => {
    router.push(filtersToHref(basePath, next))
  }

  const handleToggle = (facet: ChoiceFacet, value: string): void => {
    navigate(toggleFacet(filters, facet, value))
  }

  const handlePriceApply = (minPaise: number | null, maxPaise: number | null): void => {
    navigate(withPriceRange(filters, minPaise, maxPaise))
  }

  const handleInStockChange = (inStockOnly: boolean): void => {
    navigate(withInStockOnly(filters, inStockOnly))
  }

  return (
    <>
      <aside className="hidden w-64 shrink-0 md:block">
        <RailContents
          facets={facets}
          filters={filters}
          onToggle={handleToggle}
          onPriceApply={handlePriceApply}
          onInStockChange={handleInStockChange}
        />
      </aside>

      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="border-border-strong text-fg inline-flex items-center gap-2 rounded-control border px-4 py-2 text-sm font-medium"
        >
          <FilterIcon className="size-4" />
          Filters
        </button>

        <Modal
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Filters"
          className="m-0 mt-auto w-full max-w-none rounded-t-card rounded-b-none"
        >
          <RailContents
            facets={facets}
            filters={filters}
            onToggle={handleToggle}
            onPriceApply={handlePriceApply}
            onInStockChange={handleInStockChange}
          />
        </Modal>
      </div>
    </>
  )
}
