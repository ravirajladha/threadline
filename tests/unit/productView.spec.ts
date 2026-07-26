import { describe, expect, it } from 'vitest'

import {
  LOW_STOCK_THRESHOLD,
  defaultColourIdFor,
  priceRangeOf,
  sizePillsFor,
  swatchesFor,
  toCategorySeoView,
  toProductCardView,
  toProductDetailView,
} from '@/lib/catalog/productView'
import type { ImageView, VariantView } from '@/lib/catalog/types'
import type { Category, Colour, Media, Product, Size, SizeChart } from '@/payload-types'

const TIMESTAMPS = { createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z' }

const NAVY = { id: 1, name: 'Navy' }
const WHITE = { id: 2, name: 'White' }
const S = { id: 11, label: 'S', sortOrder: 10 }
const M = { id: 12, label: 'M', sortOrder: 20 }
const L = { id: 13, label: 'L', sortOrder: 30 }

function view(
  id: number,
  colour: { id: number; name: string },
  size: { id: number; label: string; sortOrder: number },
  available: number,
  pricePaise = 129900,
  compareAtPricePaise: number | null = null,
): VariantView {
  return {
    id,
    sku: `SHIRT-${id}`,
    sizeId: size.id,
    sizeLabel: size.label,
    sizeSortOrder: size.sortOrder,
    colourId: colour.id,
    colourName: colour.name,
    colourSlug: colour.name.toLowerCase(),
    colourHex: '#1b2a4a',
    pricePaise,
    compareAtPricePaise,
    availableQty: available,
    isAvailable: available > 0,
  }
}

function image(id: number, colourId: number | null): ImageView {
  return {
    id,
    url: `https://cdn.example.com/${id}.jpg`,
    alt: 'Oxford Shirt',
    width: 1200,
    height: 1600,
    colourId,
  }
}

function makeSize(size: { id: number; label: string; sortOrder: number }): Size {
  return { ...size, group: 'topwear', isActive: true, ...TIMESTAMPS }
}

function makeColour(colour: { id: number; name: string }): Colour {
  return {
    id: colour.id,
    name: colour.name,
    slug: colour.name.toLowerCase(),
    hex: '#1b2a4a',
    sortOrder: colour.id,
    isActive: true,
    ...TIMESTAMPS,
  }
}

/** A raw Payload variant, populated to the depth the catalog queries at. */
function rawVariant(
  id: number,
  colour: { id: number; name: string },
  size: { id: number; label: string; sortOrder: number },
  stockQty: number,
  extra: { price?: number | null; compareAtPrice?: number | null; isActive?: boolean } = {},
) {
  return {
    id,
    product: 1,
    sku: `SHIRT-${id}`,
    size: makeSize(size),
    colour: makeColour(colour),
    price: extra.price ?? null,
    compareAtPrice: extra.compareAtPrice ?? null,
    stockQty,
    reservedQty: 0,
    isActive: extra.isActive ?? true,
    ...TIMESTAMPS,
  }
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 5,
    title: 'Shirts',
    slug: 'shirts',
    sizeGroup: 'topwear',
    sortOrder: 0,
    isActive: true,
    ...TIMESTAMPS,
    ...overrides,
  }
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    title: 'Oxford Shirt',
    slug: 'oxford-shirt',
    category: makeCategory(),
    mrp: 129900,
    taxRatePct: 12,
    status: 'active',
    ...TIMESTAMPS,
    ...overrides,
  }
}

describe('priceRangeOf', () => {
  it('spans the cheapest and dearest variant', () => {
    const range = priceRangeOf([
      view(1, NAVY, S, 3, 129900),
      view(2, NAVY, M, 3, 99900),
      view(3, WHITE, L, 3, 149900),
    ])
    expect(range).toEqual({ minPaise: 99900, maxPaise: 149900 })
  })

  it('collapses to a single price when every variant costs the same', () => {
    expect(priceRangeOf([view(1, NAVY, S, 3), view(2, NAVY, M, 3)])).toEqual({
      minPaise: 129900,
      maxPaise: 129900,
    })
  })

  it('reads as zero for a product with no variants', () => {
    expect(priceRangeOf([])).toEqual({ minPaise: 0, maxPaise: 0 })
  })
})

describe('swatchesFor', () => {
  it('gives one swatch per colour, in the order the variants arrived', () => {
    const swatches = swatchesFor([
      view(1, NAVY, S, 2),
      view(2, NAVY, M, 2),
      view(3, WHITE, S, 2),
    ])
    expect(swatches.map((swatch) => swatch.id)).toEqual([1, 2])
    expect(swatches[0]).toEqual({
      id: 1,
      name: 'Navy',
      slug: 'navy',
      hex: '#1b2a4a',
      isAvailable: true,
    })
  })

  it('shows a sold-out colour rather than hiding it', () => {
    // DESIGN.md §5 — a customer who cannot find last season's colour assumes it was discontinued.
    const swatches = swatchesFor([view(1, NAVY, S, 0), view(2, NAVY, M, 0), view(3, WHITE, S, 4)])
    expect(swatches.map((swatch) => [swatch.name, swatch.isAvailable])).toEqual([
      ['Navy', false],
      ['White', true],
    ])
  })

  it('marks a colour available when any one of its sizes is', () => {
    const swatches = swatchesFor([view(1, NAVY, S, 0), view(2, NAVY, M, 1)])
    expect(swatches[0]?.isAvailable).toBe(true)
  })

  it('returns nothing for a product with no variants', () => {
    expect(swatchesFor([])).toEqual([])
  })
})

describe('defaultColourIdFor', () => {
  it('opens on the first colour with something left to sell', () => {
    const swatches = swatchesFor([view(1, NAVY, S, 0), view(2, WHITE, S, 3)])
    expect(defaultColourIdFor(swatches)).toBe(2)
  })

  it('falls back to the first swatch when the product is sold out entirely', () => {
    const swatches = swatchesFor([view(1, NAVY, S, 0), view(2, WHITE, S, 0)])
    expect(defaultColourIdFor(swatches)).toBe(1)
  })

  it('has no default when there are no swatches', () => {
    expect(defaultColourIdFor([])).toBeNull()
  })
})

describe('sizePillsFor', () => {
  const variants = [
    view(1, NAVY, S, 4),
    view(2, NAVY, M, 0),
    view(3, WHITE, S, 2),
    view(4, WHITE, L, 7),
  ]

  it('shows every size the product is made in, whatever colour is selected', () => {
    // Otherwise pills appear and vanish under the cursor as the customer changes swatch.
    expect(sizePillsFor(variants, NAVY.id).map((pill) => pill.label)).toEqual(['S', 'M', 'L'])
  })

  it('orders the pills by size sortOrder, not alphabetically', () => {
    expect(sizePillsFor(variants, null).map((pill) => pill.sortOrder)).toEqual([10, 20, 30])
  })

  it('gives a size the selected colour does not come in a pill with no variant to add', () => {
    const pill = sizePillsFor(variants, NAVY.id).find((row) => row.label === 'L')
    expect(pill).toEqual({
      sizeId: 13,
      label: 'L',
      sortOrder: 30,
      variantId: null,
      availableQty: 0,
      isAvailable: false,
      isLow: false,
    })
  })

  it('keeps a sold-out size selectable-looking but unavailable', () => {
    const pill = sizePillsFor(variants, NAVY.id).find((row) => row.label === 'M')
    expect(pill).toMatchObject({ variantId: 2, availableQty: 0, isAvailable: false, isLow: false })
  })

  it('points each pill at the variant a cart would add', () => {
    const pill = sizePillsFor(variants, WHITE.id).find((row) => row.label === 'S')
    expect(pill?.variantId).toBe(3)
  })

  it('aggregates across every colour when none is selected', () => {
    const pill = sizePillsFor(variants, null).find((row) => row.label === 'S')
    expect(pill).toMatchObject({ availableQty: 6, isAvailable: true, variantId: 1 })
  })

  it('flags low stock at the threshold but not above it', () => {
    const atThreshold = view(9, NAVY, S, LOW_STOCK_THRESHOLD)
    const aboveThreshold = view(10, NAVY, M, LOW_STOCK_THRESHOLD + 1)
    const pills = sizePillsFor([atThreshold, aboveThreshold], NAVY.id)
    expect(pills.map((pill) => pill.isLow)).toEqual([true, false])
  })

  it('never flags a sold-out size as low', () => {
    expect(sizePillsFor([view(1, NAVY, S, 0)], NAVY.id)[0]?.isLow).toBe(false)
  })

  it('returns nothing for a product with no variants', () => {
    expect(sizePillsFor([], null)).toEqual([])
  })
})

describe('toProductCardView', () => {
  it('builds a grid cell from raw variants', () => {
    const card = toProductCardView(
      makeProduct(),
      [rawVariant(1, NAVY, S, 3), rawVariant(2, WHITE, M, 0)],
      [image(21, 1), image(22, 2)],
    )

    expect(card).toMatchObject({
      id: 1,
      title: 'Oxford Shirt',
      slug: 'oxford-shirt',
      categorySlug: 'shirts',
      priceRange: { minPaise: 129900, maxPaise: 129900 },
      isSoldOut: false,
    })
    expect(card.swatches.map((swatch) => swatch.id)).toEqual([1, 2])
  })

  it('has no category slug when the relationship came back as an id', () => {
    const card = toProductCardView(makeProduct({ category: 5 }), [], [])
    expect(card.categorySlug).toBeNull()
  })

  it('is sold out when every variant is, and when there are none at all', () => {
    expect(toProductCardView(makeProduct(), [rawVariant(1, NAVY, S, 0)], []).isSoldOut).toBe(true)
    expect(toProductCardView(makeProduct(), [], []).isSoldOut).toBe(true)
  })

  it('leads with an image of the default colour', () => {
    const card = toProductCardView(
      makeProduct(),
      // Navy is sold out, so White is the default colour and its photograph leads.
      [rawVariant(1, NAVY, S, 0), rawVariant(2, WHITE, M, 5)],
      [image(21, 1), image(22, 2), image(23, 2)],
    )
    expect(card.image?.id).toBe(22)
    expect(card.hoverImage?.id).toBe(23)
  })

  it('falls back to an image of another colour for the hover frame', () => {
    const card = toProductCardView(
      makeProduct(),
      [rawVariant(1, NAVY, S, 3)],
      [image(21, 1), image(22, 2)],
    )
    expect(card.image?.id).toBe(21)
    expect(card.hoverImage?.id).toBe(22)
  })

  it('has no hover frame when the product has a single photograph', () => {
    const card = toProductCardView(makeProduct(), [rawVariant(1, NAVY, S, 3)], [image(21, null)])
    expect(card.hoverImage).toBeNull()
  })

  it('has no image at all when the gallery is empty', () => {
    const card = toProductCardView(makeProduct(), [rawVariant(1, NAVY, S, 3)], [])
    expect(card.image).toBeNull()
    expect(card.hoverImage).toBeNull()
  })

  it('reports the highest compare-at across variants', () => {
    const card = toProductCardView(
      makeProduct(),
      [
        rawVariant(1, NAVY, S, 3, { compareAtPrice: 149900 }),
        rawVariant(2, WHITE, M, 3, { compareAtPrice: 159900 }),
      ],
      [],
    )
    expect(card.compareAtPricePaise).toBe(159900)
  })

  it.each([129900, 99900])(
    'refuses to strike through a compare-at of %d that is not above the price',
    (compareAtPrice) => {
      // A strike-through that is not higher than the price is a discount that does not exist.
      const card = toProductCardView(
        makeProduct(),
        [rawVariant(1, NAVY, S, 3, { compareAtPrice })],
        [],
      )
      expect(card.compareAtPricePaise).toBeNull()
    },
  )

  it('compares against the cheapest variant, not the dearest', () => {
    const card = toProductCardView(
      makeProduct(),
      [
        rawVariant(1, NAVY, S, 3, { price: 99900 }),
        rawVariant(2, WHITE, M, 3, { price: 149900, compareAtPrice: 129900 }),
      ],
      [],
    )
    expect(card.compareAtPricePaise).toBe(129900)
  })

  it('reports the total left only when it is low enough to be worth saying', () => {
    const low = toProductCardView(
      makeProduct(),
      [rawVariant(1, NAVY, S, 2), rawVariant(2, WHITE, M, 1)],
      [],
    )
    expect(low.lowStockQty).toBe(3)

    const plenty = toProductCardView(makeProduct(), [rawVariant(1, NAVY, S, 40)], [])
    expect(plenty.lowStockQty).toBeNull()

    const none = toProductCardView(makeProduct(), [rawVariant(1, NAVY, S, 0)], [])
    expect(none.lowStockQty).toBeNull()
  })

  it('prices variants at the product MRP when they set no price of their own', () => {
    const card = toProductCardView(makeProduct({ mrp: 79900 }), [rawVariant(1, NAVY, S, 3)], [])
    expect(card.priceRange).toEqual({ minPaise: 79900, maxPaise: 79900 })
  })

  it('ignores variants the owner switched off', () => {
    const card = toProductCardView(
      makeProduct(),
      [rawVariant(1, NAVY, S, 3, { isActive: false }), rawVariant(2, WHITE, M, 3)],
      [],
    )
    expect(card.swatches.map((swatch) => swatch.id)).toEqual([2])
  })
})

describe('toProductDetailView', () => {
  const sizeChart: SizeChart = {
    id: 3,
    title: 'Menswear tops',
    group: 'topwear',
    measurements: [
      { sizeLabel: 'S', chestIn: 38, waistIn: null, lengthIn: 27, shoulderIn: 17 },
      { sizeLabel: 'M', chestIn: 40 },
    ],
    notes: 'Measurements are of the garment, not the body.',
    ...TIMESTAMPS,
  }

  function detail(product: Product, category: Category | null = makeCategory()) {
    return toProductDetailView({
      product,
      variants: [rawVariant(1, NAVY, S, 3), rawVariant(2, WHITE, M, 0)],
      images: [image(21, 1), image(22, 2)],
      category,
      sizeChart: null,
    })
  }

  it('carries the fields a product page renders', () => {
    const page = detail(
      makeProduct({
        fabric: '100% combed cotton, 180 GSM',
        careInstructions: 'Machine wash cold',
        fitNotes: 'Relaxed fit',
      }),
    )

    expect(page).toMatchObject({
      id: 1,
      title: 'Oxford Shirt',
      slug: 'oxford-shirt',
      fabric: '100% combed cotton, 180 GSM',
      careInstructions: 'Machine wash cold',
      fitNotes: 'Relaxed fit',
      taxRatePct: 12,
      mrpPaise: 129900,
      categoryId: 5,
      categoryTitle: 'Shirts',
      categorySlug: 'shirts',
      defaultColourId: 1,
    })
  })

  it('reads absent optional copy as null rather than undefined', () => {
    expect(detail(makeProduct())).toMatchObject({
      description: null,
      fabric: null,
      careInstructions: null,
      fitNotes: null,
      sizeChart: null,
    })
  })

  it('carries every image, not just the default colour, so switching swatch needs no round trip', () => {
    expect(detail(makeProduct()).images.map((img) => img.id)).toEqual([21, 22])
  })

  it('has no category when the product is uncategorised in the query', () => {
    expect(detail(makeProduct(), null)).toMatchObject({
      categoryId: null,
      categoryTitle: null,
      categorySlug: null,
    })
  })

  it('flattens the size chart, filling in the measurements the owner left blank', () => {
    const page = toProductDetailView({
      product: makeProduct(),
      variants: [],
      images: [],
      category: null,
      sizeChart,
    })

    expect(page.sizeChart).toEqual({
      title: 'Menswear tops',
      group: 'topwear',
      notes: 'Measurements are of the garment, not the body.',
      rows: [
        { sizeLabel: 'S', chestIn: 38, waistIn: null, lengthIn: 27, shoulderIn: 17 },
        { sizeLabel: 'M', chestIn: 40, waistIn: null, lengthIn: null, shoulderIn: null },
      ],
    })
  })

  it('prefers the owner-written metadata', () => {
    const page = detail(
      makeProduct({
        seo: { title: 'Oxford Shirt — Threadline', description: 'A shirt for every week' },
        fabric: '100% cotton',
      }),
    )

    expect(page.seo).toMatchObject({
      title: 'Oxford Shirt — Threadline',
      description: 'A shirt for every week',
      canonicalPath: '/p/oxford-shirt',
    })
  })

  it('falls back through the product title and its fabric', () => {
    const page = detail(makeProduct({ fabric: '100% combed cotton' }))
    expect(page.seo).toMatchObject({
      title: 'Oxford Shirt',
      description: '100% combed cotton',
    })
  })

  it('treats blank metadata as unwritten', () => {
    const page = detail(makeProduct({ seo: { title: '  ', description: '' } }))
    expect(page.seo).toMatchObject({ title: 'Oxford Shirt', description: null })
  })

  it('has no description when there is nothing to say', () => {
    expect(detail(makeProduct()).seo.description).toBeNull()
  })

  it('shares the first photograph when the owner set no OG image', () => {
    expect(detail(makeProduct()).seo.ogImageUrl).toBe('https://cdn.example.com/21.jpg')
  })

  it('prefers an OG image the owner uploaded', () => {
    const ogImage: Media = {
      id: 99,
      alt: 'Share card',
      url: 'https://cdn.example.com/og.jpg',
      ...TIMESTAMPS,
    }
    const page = detail(makeProduct({ seo: { ogImage } }))
    expect(page.seo.ogImageUrl).toBe('https://cdn.example.com/og.jpg')
  })
})

describe('toCategorySeoView', () => {
  it('canonicalises a category to its own path', () => {
    expect(toCategorySeoView(makeCategory())).toEqual({
      title: 'Shirts',
      description: null,
      ogImageUrl: null,
      canonicalPath: '/c/shirts',
    })
  })

  it('prefers the owner-written title', () => {
    const category = makeCategory({ seo: { title: 'Shirts for men', description: 'Every shirt' } })
    expect(toCategorySeoView(category)).toMatchObject({
      title: 'Shirts for men',
      description: 'Every shirt',
    })
  })
})
