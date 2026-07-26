import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  absoluteUrl,
  buildMetadata,
  categoryMetadata,
  listingMetadata,
  productMetadata,
  siteUrl,
  SITE_NAME,
} from '@/lib/seo/metadata'
import { EMPTY_FILTERS, type CategoryView, type ProductDetailView } from '@/lib/catalog/types'

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL

function setSiteUrl(value: string | undefined) {
  if (value === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = value
  }
}

afterEach(() => {
  setSiteUrl(ORIGINAL_SITE_URL)
})

describe('siteUrl', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  it('falls back to localhost when unset', () => {
    expect(siteUrl()).toBe('http://localhost:3000')
  })

  it('reads the configured origin', () => {
    setSiteUrl('https://threadline.example')
    expect(siteUrl()).toBe('https://threadline.example')
  })

  it('strips a trailing slash so no caller has to guard against a double slash', () => {
    setSiteUrl('https://threadline.example/')
    expect(siteUrl()).toBe('https://threadline.example')
  })
})

describe('absoluteUrl', () => {
  beforeEach(() => {
    setSiteUrl('https://threadline.example')
  })

  it('joins a leading-slash path', () => {
    expect(absoluteUrl('/p/oxford-shirt')).toBe('https://threadline.example/p/oxford-shirt')
  })

  it('joins a path with no leading slash to the same result', () => {
    expect(absoluteUrl('p/oxford-shirt')).toBe('https://threadline.example/p/oxford-shirt')
  })

  it('passes an already-absolute URL through unchanged', () => {
    expect(absoluteUrl('https://cdn.example.com/x.jpg')).toBe('https://cdn.example.com/x.jpg')
  })
})

describe('buildMetadata', () => {
  beforeEach(() => {
    setSiteUrl('https://threadline.example')
  })

  it('returns the bare title — the layout template supplies the site name', () => {
    // See the module docblock: appending SITE_NAME here would double it up against the
    // storefront root layout's `%s · Threadline` title template.
    const metadata = buildMetadata({ title: 'Oxford Shirt', canonicalPath: '/p/oxford-shirt' })
    expect(metadata.title).toBe('Oxford Shirt')
    expect(metadata.title).not.toContain(SITE_NAME)
  })

  it('sets an absolute canonical', () => {
    const metadata = buildMetadata({ title: 'Oxford Shirt', canonicalPath: '/p/oxford-shirt' })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/p/oxford-shirt')
  })

  it('is indexable by default', () => {
    const metadata = buildMetadata({ title: 'Oxford Shirt', canonicalPath: '/p/oxford-shirt' })
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it('honours noIndex', () => {
    const metadata = buildMetadata({
      title: 'Oxford Shirt',
      canonicalPath: '/p/oxford-shirt',
      noIndex: true,
    })
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('trims a description to 160 characters at a word boundary, with an ellipsis', () => {
    const description = `${'word '.repeat(40)}tail`.trim() // well past 160 characters
    const metadata = buildMetadata({
      title: 'Oxford Shirt',
      canonicalPath: '/p/oxford-shirt',
      description,
    })
    const result = metadata.description
    expect(result).toBeDefined()
    expect(result!.length).toBeLessThanOrEqual(161) // 160 + the ellipsis mark
    expect(result!.endsWith('…')).toBe(true)
    // Cut at a word boundary: strip the ellipsis and the result must not end mid-word, i.e.
    // it must be a prefix of the original description up to the last included space.
    const withoutEllipsis = result!.slice(0, -1)
    expect(description.startsWith(withoutEllipsis)).toBe(true)
    expect(description[withoutEllipsis.length]).toBe(' ')
  })

  it('leaves a short description untouched', () => {
    const metadata = buildMetadata({
      title: 'Oxford Shirt',
      canonicalPath: '/p/oxford-shirt',
      description: 'A crisp cotton shirt.',
    })
    expect(metadata.description).toBe('A crisp cotton shirt.')
  })

  it('omits the description when none is given', () => {
    const metadata = buildMetadata({ title: 'Oxford Shirt', canonicalPath: '/p/oxford-shirt' })
    expect(metadata.description).toBeUndefined()
  })

  it('sets openGraph and twitter blocks', () => {
    const metadata = buildMetadata({
      title: 'Oxford Shirt',
      canonicalPath: '/p/oxford-shirt',
      description: 'A crisp cotton shirt.',
      ogImageUrl: '/media/oxford.jpg',
    })
    expect(metadata.openGraph).toMatchObject({
      title: 'Oxford Shirt',
      description: 'A crisp cotton shirt.',
      url: 'https://threadline.example/p/oxford-shirt',
      siteName: SITE_NAME,
      type: 'website',
      images: [{ url: 'https://threadline.example/media/oxford.jpg' }],
    })
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Oxford Shirt',
      description: 'A crisp cotton shirt.',
      images: ['https://threadline.example/media/oxford.jpg'],
    })
  })

  it('omits the og/twitter images array when there is no image', () => {
    const metadata = buildMetadata({ title: 'Oxford Shirt', canonicalPath: '/p/oxford-shirt' })
    expect(metadata.openGraph?.images).toBeUndefined()
    expect(metadata.twitter?.images).toBeUndefined()
  })
})

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
    images: [],
    swatches: [],
    defaultColourId: null,
    variants: [],
    priceRange: { minPaise: 149900, maxPaise: 149900 },
    compareAtPricePaise: null,
    seo: {
      title: 'Oxford Shirt — Threadline',
      description: 'A crisp cotton oxford shirt, cut for everyday wear.',
      ogImageUrl: '/media/oxford.jpg',
      canonicalPath: '/p/oxford-shirt',
    },
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  }
}

function buildCategory(overrides: Partial<CategoryView> = {}): CategoryView {
  return {
    id: 1,
    title: 'Shirts',
    slug: 'shirts',
    description: null,
    sizeGroup: 'topwear',
    parentId: null,
    image: null,
    seo: {
      title: 'Shirts — Threadline',
      description: "Men's shirts for every occasion.",
      ogImageUrl: null,
      canonicalPath: '/c/shirts',
    },
    sortOrder: 1,
    ...overrides,
  }
}

describe('productMetadata', () => {
  beforeEach(() => {
    setSiteUrl('https://threadline.example')
  })

  it("builds from the product's own seo view", () => {
    const metadata = productMetadata(buildProduct())
    expect(metadata.title).toBe('Oxford Shirt — Threadline')
    expect(metadata.description).toBe('A crisp cotton oxford shirt, cut for everyday wear.')
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/p/oxford-shirt')
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })
})

describe('categoryMetadata', () => {
  beforeEach(() => {
    setSiteUrl('https://threadline.example')
  })

  it('canonicalises to itself and is indexable when unfiltered on page 1', () => {
    const metadata = categoryMetadata(buildCategory(), EMPTY_FILTERS)
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/c/shirts')
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it('canonicalises a size-filtered page to the clean category URL, noindex/follow', () => {
    const metadata = categoryMetadata(buildCategory(), { ...EMPTY_FILTERS, sizes: ['M'] })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/c/shirts')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('canonicalises a colour-filtered page to the clean category URL, noindex/follow', () => {
    const metadata = categoryMetadata(buildCategory(), { ...EMPTY_FILTERS, colours: ['blue'] })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/c/shirts')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('canonicalises a price-bounded page to the clean category URL, noindex/follow', () => {
    const metadata = categoryMetadata(buildCategory(), { ...EMPTY_FILTERS, minPrice: 100000 })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/c/shirts')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('canonicalises an in-stock-only page to the clean category URL, noindex/follow', () => {
    const metadata = categoryMetadata(buildCategory(), { ...EMPTY_FILTERS, inStockOnly: true })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/c/shirts')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('canonicalises a non-default sort to the clean category URL, noindex/follow', () => {
    const metadata = categoryMetadata(buildCategory(), { ...EMPTY_FILTERS, sort: 'price_asc' })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/c/shirts')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('two different filter orderings collapse to the same canonical', () => {
    const a = categoryMetadata(buildCategory(), { ...EMPTY_FILTERS, sizes: ['M'], colours: ['blue'] })
    const b = categoryMetadata(buildCategory(), { ...EMPTY_FILTERS, colours: ['blue'], sizes: ['M'] })
    expect(a.alternates?.canonical).toBe(b.alternates?.canonical)
    expect(a.alternates?.canonical).toBe('https://threadline.example/c/shirts')
  })

  it('self-canonicalises page 2+ of the default view, but keeps it out of the index', () => {
    const metadata = categoryMetadata(buildCategory(), { ...EMPTY_FILTERS, page: 2 })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/c/shirts?page=2')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('uses the category seo title and description', () => {
    const metadata = categoryMetadata(buildCategory(), EMPTY_FILTERS)
    expect(metadata.title).toBe('Shirts — Threadline')
    expect(metadata.description).toBe("Men's shirts for every occasion.")
  })
})

describe('listingMetadata', () => {
  beforeEach(() => {
    setSiteUrl('https://threadline.example')
  })

  it('canonicalises the unfiltered listing to /shop and is indexable', () => {
    const metadata = listingMetadata(EMPTY_FILTERS)
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/shop')
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it('canonicalises a category-filtered listing to /shop, noindex/follow', () => {
    const metadata = listingMetadata({ ...EMPTY_FILTERS, categories: ['shirts'] })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/shop')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('self-canonicalises page 2+, noindex/follow', () => {
    const metadata = listingMetadata({ ...EMPTY_FILTERS, page: 3 })
    expect(metadata.alternates?.canonical).toBe('https://threadline.example/shop?page=3')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })
})
