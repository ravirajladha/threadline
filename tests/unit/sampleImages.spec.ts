import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  escapeSvgText,
  normaliseHex,
  planSampleImages,
  readableTextColour,
  relativeLuminance,
  renderPlannedImage,
  renderSampleImage,
  renderSampleImages,
  sampleImageSvg,
  SAMPLE_IMAGE_HEIGHT,
  SAMPLE_IMAGE_WIDTH,
} from '@/seed/sampleImages'

const THREE_COLOURS = [
  { name: 'Midnight Navy', slug: 'midnight-navy', hex: '#1b2a4a' },
  { name: 'Bone White', slug: 'bone-white', hex: '#f2ede4' },
  { name: 'Olive', slug: 'olive', hex: '#5a6448' },
]

describe('escapeSvgText', () => {
  it('escapes every XML-significant character', () => {
    expect(escapeSvgText(`Tom & Jerry's <b>"Shirt"</b>`)).toBe(
      'Tom &amp; Jerry&apos;s &lt;b&gt;&quot;Shirt&quot;&lt;/b&gt;',
    )
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeSvgText('Kestrel Oxford Shirt')).toBe('Kestrel Oxford Shirt')
  })
})

describe('normaliseHex', () => {
  it('lower-cases a six-digit hex', () => {
    expect(normaliseHex('#1B2A4A')).toBe('#1b2a4a')
  })

  it('expands a three-digit hex', () => {
    expect(normaliseHex('#fA0')).toBe('#ffaa00')
  })

  it.each(['1b2a4a', '#12345', '#gggggg', 'red', '#1b2a4', ''])(
    'refuses %j',
    (input) => {
      expect(() => normaliseHex(input)).toThrow(RangeError)
    },
  )
})

describe('relativeLuminance / readableTextColour', () => {
  it('rates Ecru as light and Indigo as dark', () => {
    const ecru = relativeLuminance('#efe7d8')
    const indigo = relativeLuminance('#1b2a4a')

    expect(ecru).toBeGreaterThan(0.5)
    expect(indigo).toBeLessThan(0.5)
  })

  it('picks dark text for a light swatch and light text for a dark swatch', () => {
    expect(readableTextColour('#efe7d8')).toBe('#161412')
    expect(readableTextColour('#1b2a4a')).toBe('#f8f5ef')
  })
})

describe('sampleImageSvg', () => {
  it('embeds the escaped product title and colour name', () => {
    const svg = sampleImageSvg({
      productTitle: `Tom & Jerry's Shirt`,
      colourName: 'Bone White',
      colourHex: '#f2ede4',
    })

    expect(svg).toContain('Tom &amp; Jerry&apos;s Shirt')
    expect(svg).toContain('Bone White')
    expect(svg).toContain(`width="${SAMPLE_IMAGE_WIDTH}"`)
    expect(svg).toContain(`height="${SAMPLE_IMAGE_HEIGHT}"`)
  })

  it('is unmistakably a placeholder, not real photography', () => {
    const svg = sampleImageSvg({
      productTitle: 'Kestrel Oxford Shirt',
      colourName: 'Midnight Navy',
      colourHex: '#1b2a4a',
    })

    expect(svg).toContain('SAMPLE')
  })

  it('carries the corner label when one is given', () => {
    const svg = sampleImageSvg({
      productTitle: 'Kestrel Oxford Shirt',
      colourName: 'Midnight Navy',
      colourHex: '#1b2a4a',
      variantLabel: 'Detail',
    })

    expect(svg).toContain('>Detail<')
  })

  it('rejects an invalid colour before producing any markup', () => {
    expect(() =>
      sampleImageSvg({ productTitle: 'Shirt', colourName: 'Mystery', colourHex: 'not-a-colour' }),
    ).toThrow(RangeError)
  })
})

describe('renderSampleImage', () => {
  it('derives a deterministic, slug-based filename', async () => {
    const first = await renderSampleImage({
      productTitle: 'Kestrel Oxford Shirt',
      colourName: 'Midnight Navy',
      colourHex: '#1b2a4a',
      index: 1,
    })
    const second = await renderSampleImage({
      productTitle: 'Kestrel Oxford Shirt',
      colourName: 'Midnight Navy',
      colourHex: '#1b2a4a',
      index: 1,
    })

    expect(first.filename).toBe('kestrel-oxford-shirt-midnight-navy-1.webp')
    expect(first.colourSlug).toBe('midnight-navy')
    expect(first.filename).toBe(second.filename)
  })

  it('writes real alt text, not the filename', async () => {
    const image = await renderSampleImage({
      productTitle: 'Kestrel Oxford Shirt',
      colourName: 'Midnight Navy',
      colourHex: '#1b2a4a',
      index: 1,
    })

    expect(image.alt).toBe('Kestrel Oxford Shirt in Midnight Navy')
  })

  // The one slow test — everything else exercises the pure SVG/colour logic above so it does
  // not have to pay for a raster on every case.
  it('rasterises to a 1000×1250 WebP', async () => {
    const image = await renderSampleImage({
      productTitle: 'Kestrel Oxford Shirt',
      colourName: 'Midnight Navy',
      colourHex: '#1b2a4a',
      index: 1,
    })

    const metadata = await sharp(image.buffer).metadata()
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(SAMPLE_IMAGE_WIDTH)
    expect(metadata.height).toBe(SAMPLE_IMAGE_HEIGHT)
  })
})

describe('planSampleImages', () => {
  it('names every image without rasterising any of them', () => {
    const plans = planSampleImages({
      productTitle: 'Kestrel Oxford Shirt',
      productSlug: 'kestrel-oxford-shirt',
      colours: THREE_COLOURS,
    })

    expect(plans).toHaveLength(6) // 3 colours × the default perColour of 2
    expect(plans.every((plan) => plan.svg.startsWith('<svg'))).toBe(true)
    expect(plans.every((plan) => !('buffer' in plan))).toBe(true)
  })

  // The seed matches an existing media row on the *planned* filename but wrote the row from a
  // *rendered* one. If those two ever drift apart the lookup silently misses and a re-seed
  // doubles every image in the catalog, so they are pinned together here.
  it('plans exactly the filenames rendering produces', async () => {
    const input = {
      productTitle: 'Kestrel Oxford Shirt',
      productSlug: 'kestrel-oxford-shirt',
      colours: THREE_COLOURS,
    }

    const planned = planSampleImages(input).map((plan) => plan.filename)
    const rendered = (await renderSampleImages(input)).map((image) => image.filename)

    expect(planned).toEqual(rendered)
  })

  it('carries the alt text and colour slug through to the rendered image', async () => {
    const plan = planSampleImages({
      productTitle: 'Kestrel Oxford Shirt',
      productSlug: 'kestrel-oxford-shirt',
      colours: [THREE_COLOURS[0]!],
      perColour: 1,
    })[0]!

    const image = await renderPlannedImage(plan)

    expect(image.filename).toBe(plan.filename)
    expect(image.alt).toBe('Kestrel Oxford Shirt in Midnight Navy')
    expect(image.colourSlug).toBe('midnight-navy')
  })

  // Planning is the cheap step, so it is where a bad colour has to be caught — a RangeError here
  // costs nothing, whereas the same mistake reaching `sharp` costs a raster to find out.
  it('rejects a bad colour before any raster is attempted', () => {
    expect(() =>
      planSampleImages({
        productTitle: 'Kestrel Oxford Shirt',
        productSlug: 'kestrel-oxford-shirt',
        colours: [{ name: 'Mystery', slug: 'mystery', hex: 'rebeccapurple' }],
      }),
    ).toThrow(RangeError)
  })
})

describe('renderPlannedImage', () => {
  // A raster failure is environment-dependent — a libvips without librsvg, a fontconfig with no
  // fonts — and arrives from `sharp` with no idea which of a seed run's dozens of images caused
  // it. The wrapper has to say which, and must not lose the original underneath.
  it('names the image it failed on and keeps the underlying cause', async () => {
    const broken = {
      filename: 'kestrel-oxford-shirt-midnight-navy-1.webp',
      alt: 'Kestrel Oxford Shirt in Midnight Navy',
      colourSlug: 'midnight-navy',
      svg: 'this is not an svg',
    }

    await expect(renderPlannedImage(broken)).rejects.toThrow(
      /kestrel-oxford-shirt-midnight-navy-1\.webp/,
    )
    await expect(renderPlannedImage(broken)).rejects.toHaveProperty('cause')
  })
})

describe('renderSampleImages', () => {
  it('renders perColour images for every colour, all uniquely named', async () => {
    const images = await renderSampleImages({
      productTitle: 'Kestrel Oxford Shirt',
      productSlug: 'kestrel-oxford-shirt',
      colours: THREE_COLOURS,
    })

    expect(images).toHaveLength(6) // 3 colours × the default perColour of 2
    expect(new Set(images.map((image) => image.filename)).size).toBe(6)
  })

  it('honours a custom perColour', async () => {
    const images = await renderSampleImages({
      productTitle: 'Everyday Heavy Tee',
      productSlug: 'everyday-heavy-tee',
      colours: [{ name: 'Charcoal', slug: 'charcoal', hex: '#3a3a3c' }],
      perColour: 1,
    })

    expect(images).toHaveLength(1)
    expect(images[0]?.filename).toBe('everyday-heavy-tee-charcoal-1.webp')
  })

  it('builds filenames from the given slugs, not from re-slugifying the names', async () => {
    const images = await renderSampleImages({
      productTitle: 'Product Title Has Changed Since',
      productSlug: 'original-slug',
      colours: [{ name: 'Renamed Colour', slug: 'original-colour-slug', hex: '#5a6448' }],
      perColour: 1,
    })

    expect(images[0]?.filename).toBe('original-slug-original-colour-slug-1.webp')
  })
})
