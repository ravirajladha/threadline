/**
 * Flattening a variant into something a page can render.
 *
 * Payload hands back a relationship as either a bare id or a fully populated document, depending
 * on the `depth` the query asked for, and every optional field arrives as `T | null | undefined`.
 * Rendering against that shape means a ternary at every call site, and it does not survive the
 * server → client boundary intact. This module is the one place that decides what a variant
 * really is, so that everything downstream sees the flat, non-null `VariantView`.
 *
 * The rule the rest of the storefront depends on: `availableQty` is stock minus what checkouts
 * in progress are holding, floored at zero. A negative figure means the ledger and the reserved
 * count disagree — a data problem for the owner to find, never a number a customer is shown or
 * allowed to order against.
 */
import type { Colour, Product, Size, Variant } from '@/payload-types'

import type { VariantView } from './types'

/**
 * A variant as it comes back from a query deep enough to populate its size and colour.
 *
 * `product` stays a union: the catalog reads the product separately and does not need it
 * populated here, but a query that does populate it must still satisfy this type.
 */
export type PopulatedVariant = Omit<Variant, 'size' | 'colour' | 'product'> & {
  size: Size
  colour: Colour
  product: number | Product
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSize(value: unknown): value is Size {
  return isRecord(value) && typeof value.id === 'number' && typeof value.label === 'string'
}

function isColour(value: unknown): value is Colour {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.name === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.hex === 'string'
  )
}

/**
 * Whether a value is a variant with its size and colour populated.
 *
 * Exported so a caller can filter a mixed array — a query result where some rows came back
 * shallow — without casting. Anything this rejects is dropped rather than rendered half-built:
 * a swatch with no colour is worse than one fewer swatch.
 */
export function isPopulatedVariant(variant: unknown): variant is PopulatedVariant {
  return (
    isRecord(variant) &&
    typeof variant.id === 'number' &&
    typeof variant.sku === 'string' &&
    isSize(variant.size) &&
    isColour(variant.colour)
  )
}

/**
 * How many units can actually be sold: stock minus the units held by checkouts in progress.
 *
 * Floored at zero, and a missing figure counts as zero — an absent `stockQty` means no movement
 * has ever been recorded, which is nothing to sell rather than an unknown quantity to gamble on.
 */
export function availableQty(
  stockQty: number | null | undefined,
  reservedQty: number | null | undefined,
): number {
  return Math.max(0, (stockQty ?? 0) - (reservedQty ?? 0))
}

/**
 * One variant, flattened against its product's MRP.
 *
 * The price falls back to the product MRP only when the variant has no price of its own.
 * `??` rather than `||` is deliberate: a variant priced at 0 is a real free item — a gift with
 * purchase — and must sell at zero rather than quietly reverting to the MRP.
 *
 * A missing `sortOrder` reads as 0, matching the collection default, so an unsorted size or
 * colour sorts first rather than being thrown to the end of the list.
 */
export function toVariantView(variant: PopulatedVariant, productMrpPaise: number): VariantView {
  const available = availableQty(variant.stockQty, variant.reservedQty)

  return {
    id: variant.id,
    sku: variant.sku,
    sizeId: variant.size.id,
    sizeLabel: variant.size.label,
    sizeSortOrder: variant.size.sortOrder ?? 0,
    colourId: variant.colour.id,
    colourName: variant.colour.name,
    colourSlug: variant.colour.slug,
    colourHex: variant.colour.hex,
    pricePaise: variant.price ?? productMrpPaise,
    compareAtPricePaise: variant.compareAtPrice ?? null,
    availableQty: available,
    isAvailable: available > 0,
  }
}

/**
 * Every sellable row of a product, in the order it should render.
 *
 * Rows that came back shallow are dropped — see `isPopulatedVariant` — and so are ones the owner
 * has switched off. Only an explicit `false` counts as switched off: the field defaults to true
 * in the collection, so a null means "never set", and reading that as "disabled" would empty the
 * storefront on the day a migration adds the column.
 *
 * Colour leads the sort because the product page groups by swatch; size follows so the pills read
 * S, M, L. Labels break both ties, so a catalog that leaves two colours on the same `sortOrder`
 * still renders in the same order on every request instead of wobbling between them.
 */
export function toVariantViews(variants: readonly unknown[], productMrpPaise: number): VariantView[] {
  const rows: { view: VariantView; colourSortOrder: number }[] = []

  for (const variant of variants) {
    if (!isPopulatedVariant(variant)) continue
    if (variant.isActive === false) continue

    rows.push({
      view: toVariantView(variant, productMrpPaise),
      colourSortOrder: variant.colour.sortOrder ?? 0,
    })
  }

  rows.sort((a, b) => {
    if (a.colourSortOrder !== b.colourSortOrder) return a.colourSortOrder - b.colourSortOrder
    if (a.view.colourName !== b.view.colourName) {
      return a.view.colourName < b.view.colourName ? -1 : 1
    }
    if (a.view.sizeSortOrder !== b.view.sizeSortOrder) {
      return a.view.sizeSortOrder - b.view.sizeSortOrder
    }
    if (a.view.sizeLabel !== b.view.sizeLabel) return a.view.sizeLabel < b.view.sizeLabel ? -1 : 1
    return a.view.id - b.view.id
  })

  return rows.map((row) => row.view)
}
