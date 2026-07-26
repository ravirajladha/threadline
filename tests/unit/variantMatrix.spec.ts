import { describe, expect, it } from 'vitest'

import { planVariantMatrix } from '@/lib/inventory/variantMatrix'

const SIZES = [
  { id: 1, label: 'S' },
  { id: 2, label: 'M' },
  { id: 3, label: 'L' },
]

const COLOURS = [
  { id: 10, name: 'Midnight Navy' },
  { id: 11, name: 'Bone White' },
]

describe('planVariantMatrix', () => {
  it('expands every size against every colour', () => {
    const plan = planVariantMatrix('Oxford Shirt', SIZES, COLOURS)

    expect(plan.requested).toBe(6)
    expect(plan.create).toHaveLength(6)
    expect(plan.skipped).toBe(0)
  })

  it('generates each SKU from the product, colour and size', () => {
    const plan = planVariantMatrix('Oxford Shirt', SIZES, COLOURS)

    expect(plan.create.map((v) => v.sku)).toEqual([
      'OXFORDSHIRT-MIDNI-S',
      'OXFORDSHIRT-BONEW-S',
      'OXFORDSHIRT-MIDNI-M',
      'OXFORDSHIRT-BONEW-M',
      'OXFORDSHIRT-MIDNI-L',
      'OXFORDSHIRT-BONEW-L',
    ])
  })

  it('orders size-major, so the admin list reads predictably', () => {
    const plan = planVariantMatrix('Oxford Shirt', SIZES, COLOURS)
    expect(plan.create.map((v) => `${v.sizeLabel}/${v.colourName}`)).toEqual([
      'S/Midnight Navy',
      'S/Bone White',
      'M/Midnight Navy',
      'M/Bone White',
      'L/Midnight Navy',
      'L/Bone White',
    ])
  })

  it('skips combinations that already exist', () => {
    const plan = planVariantMatrix('Oxford Shirt', SIZES, COLOURS, [
      { size: 1, colour: 10 },
      { size: 2, colour: 11 },
    ])

    expect(plan.skipped).toBe(2)
    expect(plan.create).toHaveLength(4)
    expect(plan.create.map((v) => `${v.size}-${v.colour}`)).not.toContain('1-10')
  })

  it('creates nothing on a second run — safe to press the button again', () => {
    const first = planVariantMatrix('Oxford Shirt', SIZES, COLOURS)
    const existing = first.create.map((v) => ({ size: v.size, colour: v.colour }))

    const second = planVariantMatrix('Oxford Shirt', SIZES, COLOURS, existing)

    expect(second.create).toHaveLength(0)
    expect(second.skipped).toBe(6)
  })

  it('adds only the new column when a colour is introduced later', () => {
    // The realistic case: the owner generated S/M/L in navy, then added white.
    const existing = SIZES.map((size) => ({ size: size.id, colour: 10 }))
    const plan = planVariantMatrix('Oxford Shirt', SIZES, COLOURS, existing)

    expect(plan.create).toHaveLength(3)
    expect(plan.create.every((v) => v.colour === 11)).toBe(true)
  })

  it('tolerates the same size listed twice without creating a duplicate', () => {
    const plan = planVariantMatrix('Oxford Shirt', [SIZES[0]!, SIZES[0]!], [COLOURS[0]!])
    expect(plan.create).toHaveLength(1)
  })

  it('ignores an existing combination outside the selection', () => {
    const plan = planVariantMatrix('Oxford Shirt', SIZES, COLOURS, [{ size: 99, colour: 99 }])
    expect(plan.create).toHaveLength(6)
    expect(plan.skipped).toBe(0)
  })

  it.each([
    [[], COLOURS],
    [SIZES, []],
    [[], []],
  ])('refuses an empty selection rather than silently doing nothing', (sizes, colours) => {
    expect(() => planVariantMatrix('Oxford Shirt', sizes, colours)).toThrow(RangeError)
  })

  it('propagates a SKU failure rather than creating an unlabelled variant', () => {
    expect(() => planVariantMatrix('', SIZES, COLOURS)).toThrow(RangeError)
  })
})
