import { describe, expect, it } from 'vitest'

import {
  breadcrumbJsonLd,
  escapeJsonLd,
  organisationJsonLd,
  productJsonLd,
  websiteJsonLd,
} from '@/lib/seo/jsonLd'
import type { Crumb, ProductDetailView, VariantView } from '@/lib/catalog/types'

describe('escapeJsonLd', () => {
  it('round-trips ordinary data unharmed', () => {
    const data = { name: 'Oxford Shirt', price: '499.00' }
    expect(JSON.parse(escapeJsonLd(data))).toEqual(data)
  })

  it('neutralises a </script> payload so the substring never appears in the output', () => {
    const data = { name: '</script><img src=x onerror=alert(1)>' }
    const escaped = escapeJsonLd(data)
    expect(escaped).not.toContain('</script')
    expect(escaped).not.toContain('<script')
  })

  it('round-trips the </script> payload back to the exact original string', () => {
    const data = { name: '</script><img src=x onerror=alert(1)>' }
    const escaped = escapeJsonLd(data)
    expect(JSON.parse(escaped)).toEqual(data)
  })

  it('escapes a bare ampersand', () => {
    const escaped = escapeJsonLd({ name: 'Fit & Flare' })
    expect(escaped).not.toContain('&')
    expect(JSON.parse(escaped)).toEqual({ name: 'Fit & Flare' })
  })

  it('escapes the line and paragraph separators', () => {
    const data = { name: 'Line\u2028Break\u2029Here' }
    const escaped = escapeJsonLd(data)
    expect(escaped).not.toContain('\u2028')
    expect(escaped).not.toContain('\u2029')
    expect(JSON.parse(escaped)).toEqual(data)
  })
})

function buildVariant(overrides: Partial<VariantView> = {}): VariantView {
  return {
    id: 1,
    sku: 'OXF-BLU-M',
    sizeId: 1,
    sizeLabel: 'M',
    sizeSortOrder: 2,
    colourId: 1,
    colourName: 'Blue',
    colourSlug: 'blue',
    colourHex: '#1d4ed8',
    pricePaise: 149900,
    compareAtPricePaise: null,
    availableQty: 5,
    isAvailable: true,
    ...overrides,
  }
}

function buildProduct(overrides: Partial<ProductDetailView> = {}): ProductDetailView {
  return {
    id: 1,
    title: 'Oxford Shirt',
    slug: 'oxford-shirt',
    description: null,
    fabric: null,
    careInstructions: null,
    fitNotes: null,
    taxRatePct: 12,
    mrpPaise: 149900,
    categoryId: 1,
    categoryTitle: 'Shirts',
    categorySlug: 'shirts',
    sizeChart: null,
    images: [
      { id: 1, url: '/api/media/file/oxford-1.jpg', alt: 'Oxford shirt, front', width: 800, height: 1000, colourId: 1 },
      { id: 2, url: '/api/media/file/oxford-2.jpg', alt: 'Oxford shirt, back', width: 800, height: 1000, colourId: 1 },
    ],
    swatches: [],
    defaultColourId: 1,
    variants: [buildVariant()],
    priceRange: { minPaise: 149900, maxPaise: 149900 },
    compareAtPricePaise: null,
    seo: {
      title: 'Oxford Shirt — Threadline',
      description: 'A crisp cotton oxford shirt, cut for everyday wear.',
      ogImageUrl: '/api/media/file/oxford-1.jpg',
      canonicalPath: '/p/oxford-shirt',
    },
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  }
}

describe('productJsonLd', () => {
  it('builds a single Offer when every variant shares one price', () => {
    const doc = productJsonLd(buildProduct())
    expect(doc['@type']).toBe('Product')
    expect(doc.name).toBe('Oxford Shirt')
    expect(doc.description).toBe('A crisp cotton oxford shirt, cut for everyday wear.')
    expect(doc.sku).toBe('OXF-BLU-M')
    expect(doc.offers).toMatchObject({
      '@type': 'Offer',
      price: '1499.00',
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
    })
  })

  it('builds an AggregateOffer when the price range spans', () => {
    const doc = productJsonLd(
      buildProduct({
        priceRange: { minPaise: 129900, maxPaise: 179900 },
        variants: [buildVariant(), buildVariant({ id: 2, sku: 'OXF-BLU-L', pricePaise: 179900 })],
      }),
    )
    expect(doc.offers).toMatchObject({
      '@type': 'AggregateOffer',
      lowPrice: '1299.00',
      highPrice: '1799.00',
      priceCurrency: 'INR',
      offerCount: 2,
    })
  })

  it('reports OutOfStock when no variant is available', () => {
    const doc = productJsonLd(buildProduct({ variants: [buildVariant({ isAvailable: false })] }))
    const offers = doc.offers as Record<string, unknown>
    expect(offers.availability).toBe('https://schema.org/OutOfStock')
  })

  it('reports InStock when at least one variant is available', () => {
    const doc = productJsonLd(
      buildProduct({
        variants: [buildVariant({ isAvailable: false }), buildVariant({ id: 2, isAvailable: true })],
      }),
    )
    const offers = doc.offers as Record<string, unknown>
    expect(offers.availability).toBe('https://schema.org/InStock')
  })

  it('resolves image URLs to absolute URLs', () => {
    const doc = productJsonLd(buildProduct())
    expect(doc.image).toEqual([
      expect.stringContaining('/api/media/file/oxford-1.jpg'),
      expect.stringContaining('/api/media/file/oxford-2.jpg'),
    ])
    expect((doc.image as string[])[0]).toMatch(/^https?:\/\//)
  })

  it('sets the brand', () => {
    const doc = productJsonLd(buildProduct())
    expect(doc.brand).toEqual({ '@type': 'Brand', name: 'Threadline' })
  })

  it('never emits undefined-valued keys — sku is dropped when there are no variants', () => {
    const doc = productJsonLd(buildProduct({ variants: [], priceRange: { minPaise: 0, maxPaise: 0 } }))
    expect('sku' in doc).toBe(false)
    expect(JSON.stringify(doc)).not.toContain('undefined')
  })

  it('drops the image key entirely when the product has no images', () => {
    const doc = productJsonLd(buildProduct({ images: [] }))
    expect('image' in doc).toBe(false)
  })

  it('drops the description key when the seo description is null', () => {
    const doc = productJsonLd(
      buildProduct({
        seo: {
          title: 'Oxford Shirt — Threadline',
          description: null,
          ogImageUrl: null,
          canonicalPath: '/p/oxford-shirt',
        },
      }),
    )
    expect('description' in doc).toBe(false)
  })
})

describe('breadcrumbJsonLd', () => {
  it('assigns 1-based positions and absolute item URLs', () => {
    const crumbs: Crumb[] = [
      { title: 'Home', href: '/' },
      { title: 'Shirts', href: '/c/shirts' },
      { title: 'Oxford Shirt', href: null },
    ]
    const doc = breadcrumbJsonLd(crumbs)
    const items = doc.itemListElement as Record<string, unknown>[]
    expect(items[0]).toMatchObject({ '@type': 'ListItem', position: 1, name: 'Home' })
    expect(items[0]!.item).toMatch(/^https?:\/\/.*\/$/)
    expect(items[1]).toMatchObject({ position: 2, name: 'Shirts' })
    expect(items[1]!.item).toMatch(/\/c\/shirts$/)
  })

  it('lists the current page as the last crumb without an item URL', () => {
    const crumbs: Crumb[] = [
      { title: 'Home', href: '/' },
      { title: 'Oxford Shirt', href: null },
    ]
    const doc = breadcrumbJsonLd(crumbs)
    const items = doc.itemListElement as Record<string, unknown>[]
    const last = items[items.length - 1]!
    expect(last.position).toBe(2)
    expect(last.name).toBe('Oxford Shirt')
    expect('item' in last).toBe(false)
  })
})

describe('websiteJsonLd', () => {
  it('includes a SearchAction targeting /shop', () => {
    const doc = websiteJsonLd()
    expect(doc['@type']).toBe('WebSite')
    const action = doc.potentialAction as Record<string, unknown>
    expect(action['@type']).toBe('SearchAction')
    const target = action.target as Record<string, unknown>
    expect(target.urlTemplate).toContain('/shop?q={search_term_string}')
    expect(action['query-input']).toBe('required name=search_term_string')
  })
})

describe('organisationJsonLd', () => {
  it('names the organisation', () => {
    const doc = organisationJsonLd()
    expect(doc['@type']).toBe('Organization')
    expect(doc.name).toBe('Threadline')
    expect(typeof doc.url).toBe('string')
  })
})
