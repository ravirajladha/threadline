import { describe, expect, it } from 'vitest'

import {
  availableQty,
  isPopulatedVariant,
  toVariantView,
  toVariantViews,
  type PopulatedVariant,
} from '@/lib/catalog/variantView'
import type { Colour, Size } from '@/payload-types'

const TIMESTAMPS = { createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z' }

function makeSize(id: number, label: string, sortOrder: number | null = 0): Size {
  return { id, label, group: 'topwear', sortOrder, isActive: true, ...TIMESTAMPS }
}

function makeColour(id: number, name: string, sortOrder: number | null = 0): Colour {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    hex: `#00000${id}`,
    sortOrder,
    isActive: true,
    ...TIMESTAMPS,
  }
}

const SIZE_S = makeSize(1, 'S', 10)
const SIZE_M = makeSize(2, 'M', 20)
const SIZE_L = makeSize(3, 'L', 30)
const NAVY = makeColour(1, 'Navy', 10)
const WHITE = makeColour(2, 'White', 20)

interface VariantSpec {
  id: number
  size?: Size
  colour?: Colour
  sku?: string
  price?: number | null
  compareAtPrice?: number | null
  stockQty?: number | null
  reservedQty?: number | null
  isActive?: boolean | null
}

function makeVariant(spec: VariantSpec): PopulatedVariant {
  return {
    id: spec.id,
    product: 1,
    sku: spec.sku ?? `SHIRT-${spec.id}`,
    size: spec.size ?? SIZE_M,
    colour: spec.colour ?? NAVY,
    price: spec.price ?? null,
    compareAtPrice: spec.compareAtPrice ?? null,
    stockQty: spec.stockQty ?? 0,
    reservedQty: spec.reservedQty ?? 0,
    barcode: null,
    weightGrams: null,
    isActive: spec.isActive ?? true,
    ...TIMESTAMPS,
  }
}

describe('availableQty', () => {
  it('is stock less the units held by checkouts in progress', () => {
    expect(availableQty(10, 3)).toBe(7)
  })

  it('floors at zero when reservations exceed stock', () => {
    // Negative availability means the ledger and the reserved count disagree — a problem for the
    // owner to find, never a number a customer is shown or can order against.
    expect(availableQty(2, 5)).toBe(0)
  })

  it.each([
    [null, null],
    [undefined, undefined],
    [null, 4],
    [undefined, 4],
  ])('treats a missing figure as zero (%j, %j)', (stock, reserved) => {
    expect(availableQty(stock, reserved)).toBe(0)
  })

  it('counts a missing reservation as none held', () => {
    expect(availableQty(6, null)).toBe(6)
  })
})

describe('isPopulatedVariant', () => {
  it('accepts a variant whose size and colour came back populated', () => {
    expect(isPopulatedVariant(makeVariant({ id: 1 }))).toBe(true)
  })

  it('rejects a row whose size is still an id', () => {
    expect(isPopulatedVariant({ ...makeVariant({ id: 1 }), size: 2 })).toBe(false)
  })

  it('rejects a row whose colour is still an id', () => {
    expect(isPopulatedVariant({ ...makeVariant({ id: 1 }), colour: 2 })).toBe(false)
  })

  it('rejects a colour missing its swatch hex', () => {
    const colour = { id: 1, name: 'Navy', slug: 'navy', ...TIMESTAMPS }
    expect(isPopulatedVariant({ ...makeVariant({ id: 1 }), colour })).toBe(false)
  })

  it.each([null, undefined, 7, 'variant'])('rejects %j', (value) => {
    expect(isPopulatedVariant(value)).toBe(false)
  })

  it('rejects an empty object', () => {
    expect(isPopulatedVariant({})).toBe(false)
  })
})

describe('toVariantView', () => {
  it('flattens the relationships a component would otherwise have to unwrap', () => {
    const view = toVariantView(
      makeVariant({
        id: 42,
        sku: 'SHIRT-NAV-M',
        size: SIZE_M,
        colour: NAVY,
        price: 129900,
        compareAtPrice: 159900,
        stockQty: 9,
        reservedQty: 2,
      }),
      99900,
    )

    expect(view).toEqual({
      id: 42,
      sku: 'SHIRT-NAV-M',
      sizeId: 2,
      sizeLabel: 'M',
      sizeSortOrder: 20,
      colourId: 1,
      colourName: 'Navy',
      colourSlug: 'navy',
      colourHex: '#000001',
      pricePaise: 129900,
      compareAtPricePaise: 159900,
      availableQty: 7,
      isAvailable: true,
    })
  })

  it('falls back to the product MRP when the variant sets no price', () => {
    expect(toVariantView(makeVariant({ id: 1, price: null }), 99900).pricePaise).toBe(99900)
  })

  it('falls back to the product MRP when the price is absent entirely', () => {
    const variant: PopulatedVariant = { ...makeVariant({ id: 1 }), price: undefined }
    expect(toVariantView(variant, 99900).pricePaise).toBe(99900)
  })

  it('honours a price of zero rather than reverting to the MRP', () => {
    // A gift with purchase is priced at nothing on purpose. `||` would sell it at full price.
    expect(toVariantView(makeVariant({ id: 1, price: 0 }), 99900).pricePaise).toBe(0)
  })

  it('reports no compare-at when the owner has not set one', () => {
    expect(toVariantView(makeVariant({ id: 1 }), 99900).compareAtPricePaise).toBeNull()
  })

  it('is unavailable when everything left is reserved', () => {
    const view = toVariantView(makeVariant({ id: 1, stockQty: 3, reservedQty: 3 }), 99900)
    expect(view).toMatchObject({ availableQty: 0, isAvailable: false })
  })

  it('reads a missing sortOrder as zero, matching the collection default', () => {
    const view = toVariantView(
      makeVariant({ id: 1, size: makeSize(4, 'XL', null), colour: makeColour(3, 'Ecru', null) }),
      99900,
    )
    expect(view.sizeSortOrder).toBe(0)
  })
})

describe('toVariantViews', () => {
  it('drops rows that came back without their relationships populated', () => {
    const rows = [makeVariant({ id: 1, stockQty: 4 }), { ...makeVariant({ id: 2 }), size: 9 }, null]
    expect(toVariantViews(rows, 99900).map((view) => view.id)).toEqual([1])
  })

  it('drops variants the owner has switched off', () => {
    const rows = [makeVariant({ id: 1 }), makeVariant({ id: 2, isActive: false })]
    expect(toVariantViews(rows, 99900).map((view) => view.id)).toEqual([1])
  })

  it('keeps a variant whose isActive was never set', () => {
    // The collection defaults the field to true, so an absent value means "never set" — reading
    // it as "disabled" would empty the storefront the day a migration adds the column.
    const variant: PopulatedVariant = { ...makeVariant({ id: 5 }), isActive: undefined }
    expect(toVariantViews([variant], 99900).map((view) => view.id)).toEqual([5])
  })

  it('sorts by colour first, then size, so the page groups by swatch', () => {
    const rows = [
      makeVariant({ id: 1, colour: WHITE, size: SIZE_M }),
      makeVariant({ id: 2, colour: NAVY, size: SIZE_L }),
      makeVariant({ id: 3, colour: WHITE, size: SIZE_S }),
      makeVariant({ id: 4, colour: NAVY, size: SIZE_S }),
    ]

    expect(toVariantViews(rows, 99900).map((view) => `${view.colourName}/${view.sizeLabel}`)).toEqual(
      ['Navy/S', 'Navy/L', 'White/S', 'White/M'],
    )
  })

  it('breaks a tied sortOrder on the label so the order never wobbles between renders', () => {
    const amber = makeColour(7, 'Amber', 5)
    const azure = makeColour(8, 'Azure', 5)
    const rows = [
      makeVariant({ id: 1, colour: azure, size: makeSize(9, 'B', 1) }),
      makeVariant({ id: 2, colour: amber, size: makeSize(10, 'A', 1) }),
      makeVariant({ id: 3, colour: azure, size: makeSize(10, 'A', 1) }),
    ]

    expect(toVariantViews(rows, 99900).map((view) => view.id)).toEqual([2, 3, 1])
  })

  it('returns nothing for a product with no variants', () => {
    expect(toVariantViews([], 99900)).toEqual([])
  })
})
