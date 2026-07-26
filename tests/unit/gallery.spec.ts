import { describe, expect, it } from 'vitest'

import { galleryFor, toImageViews } from '@/lib/catalog/gallery'
import type { ImageView } from '@/lib/catalog/types'
import type { Colour, Media, Product } from '@/payload-types'

const TIMESTAMPS = { createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z' }

function makeMedia(id: number, overrides: Partial<Media> = {}): Media {
  return {
    id,
    alt: '',
    url: `https://cdn.example.com/shirt-${id}.jpg`,
    width: 1200,
    height: 1600,
    ...TIMESTAMPS,
    ...overrides,
  }
}

function makeColour(id: number, name: string): Colour {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    hex: '#1b2a4a',
    sortOrder: 0,
    isActive: true,
    ...TIMESTAMPS,
  }
}

const NAVY = makeColour(1, 'Midnight Navy')
const WHITE = makeColour(2, 'Chalk White')

function image(id: number, colourId: number | null): ImageView {
  return {
    id,
    url: `https://cdn.example.com/shirt-${id}.jpg`,
    alt: 'Oxford Shirt',
    width: 1200,
    height: 1600,
    colourId,
  }
}

describe('toImageViews', () => {
  it('maps a populated gallery row to a renderable image', () => {
    const gallery: Product['gallery'] = [{ image: makeMedia(11, { alt: 'Navy Oxford, front' }) }]

    expect(toImageViews(gallery, 'Oxford Shirt')).toEqual([
      {
        id: 11,
        url: 'https://cdn.example.com/shirt-11.jpg',
        alt: 'Navy Oxford, front',
        width: 1200,
        height: 1600,
        colourId: null,
      },
    ])
  })

  it('carries the colour tag so the gallery can be filtered by swatch', () => {
    const gallery: Product['gallery'] = [{ image: makeMedia(11), colour: NAVY }]
    expect(toImageViews(gallery, 'Oxford Shirt')[0]?.colourId).toBe(1)
  })

  it('reads a colour left as an id as untagged', () => {
    const gallery: Product['gallery'] = [{ image: makeMedia(11), colour: 3 }]
    expect(toImageViews(gallery, 'Oxford Shirt')[0]?.colourId).toBeNull()
  })

  it('falls back to product and colour for alt text when the media has none', () => {
    const gallery: Product['gallery'] = [{ image: makeMedia(11), colour: WHITE }]
    expect(toImageViews(gallery, 'Oxford Shirt')[0]?.alt).toBe('Oxford Shirt — Chalk White')
  })

  it('falls back to the product title alone when the row has no colour', () => {
    const gallery: Product['gallery'] = [{ image: makeMedia(11, { alt: '   ' }) }]
    expect(toImageViews(gallery, 'Oxford Shirt')[0]?.alt).toBe('Oxford Shirt')
  })

  it('skips a row whose media is still an id', () => {
    // Not deep enough to render — a broken frame is worse than one fewer photograph.
    const gallery: Product['gallery'] = [{ image: 11 }, { image: makeMedia(12) }]
    expect(toImageViews(gallery, 'Oxford Shirt').map((view) => view.id)).toEqual([12])
  })

  it.each([null, undefined, ''])('skips media with a url of %j', (url) => {
    const gallery: Product['gallery'] = [{ image: makeMedia(11, { url }) }]
    expect(toImageViews(gallery, 'Oxford Shirt')).toEqual([])
  })

  it('reads missing dimensions as unknown rather than zero', () => {
    const gallery: Product['gallery'] = [{ image: makeMedia(11, { width: null, height: null }) }]
    expect(toImageViews(gallery, 'Oxford Shirt')[0]).toMatchObject({ width: null, height: null })
  })

  it.each([null, undefined])('returns nothing for a gallery of %j', (gallery) => {
    expect(toImageViews(gallery, 'Oxford Shirt')).toEqual([])
  })

  it('keeps the order the owner arranged', () => {
    const gallery: Product['gallery'] = [
      { image: makeMedia(13) },
      { image: makeMedia(11) },
      { image: makeMedia(12) },
    ]
    expect(toImageViews(gallery, 'Oxford Shirt').map((view) => view.id)).toEqual([13, 11, 12])
  })
})

describe('galleryFor', () => {
  const images = [image(1, 1), image(2, 1), image(3, 2), image(4, null)]

  it('returns everything when no colour is selected', () => {
    expect(galleryFor(images, null).map((view) => view.id)).toEqual([1, 2, 3, 4])
  })

  it('returns only the images tagged with the selected colour', () => {
    expect(galleryFor(images, 1).map((view) => view.id)).toEqual([1, 2])
  })

  it('falls back to the untagged images when the colour has none of its own', () => {
    const partlyTagged = [image(1, 1), image(4, null), image(5, null)]
    expect(galleryFor(partlyTagged, 2).map((view) => view.id)).toEqual([4, 5])
  })

  it('falls back to the whole gallery when nothing is untagged either', () => {
    const allTagged = [image(1, 1), image(3, 2)]
    expect(galleryFor(allTagged, 9).map((view) => view.id)).toEqual([1, 3])
  })

  it('never mixes rungs of the fallback chain', () => {
    // The customer sees one colour's photographs or the generic set, never one of each.
    expect(galleryFor(images, 2).map((view) => view.id)).toEqual([3])
  })

  it('returns nothing when there are no images at all', () => {
    expect(galleryFor([], 1)).toEqual([])
  })

  it('does not hand back the caller its own array to mutate', () => {
    const result = galleryFor(images, null)
    expect(result).not.toBe(images)
  })
})
