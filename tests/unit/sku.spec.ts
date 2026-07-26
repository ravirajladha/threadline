import { describe, expect, it } from 'vitest'

import { buildSku } from '@/lib/inventory/sku'

describe('buildSku', () => {
  it('builds PRODUCT-COLOUR-SIZE in uppercase', () => {
    expect(buildSku('Oxford Shirt', 'Navy', 'M')).toBe('OXFORDSHIRT-NAVY-M')
  })

  it('drops spaces and punctuation rather than encoding them', () => {
    expect(buildSku('Men’s Tee', 'Off White', 'XL')).toBe('MENSTEE-OFFWH-XL')
  })

  it('truncates a long product name so the label stays scannable', () => {
    expect(buildSku('Heavyweight Oversized Hoodie', 'Charcoal', 'L')).toBe('HEAVYWEIGHTO-CHARC-L')
  })

  it('keeps numeric sizes intact', () => {
    expect(buildSku('Slim Chinos', 'Khaki', '32')).toBe('SLIMCHINOS-KHAKI-32')
  })

  it('keeps a multi-part kids size intact', () => {
    expect(buildSku('Play Tee', 'Red', '4-5Y')).toBe('PLAYTEE-RED-45Y')
  })

  it('folds accents instead of dropping the whole segment', () => {
    expect(buildSku('Été Shirt', 'Écru', 'S')).toBe('ETESHIRT-ECRU-S')
  })

  it.each([
    ['', 'Navy', 'M'],
    ['Oxford Shirt', '', 'M'],
    ['Oxford Shirt', 'Navy', ''],
    ['!!!', 'Navy', 'M'],
  ])('throws rather than emit a colliding SKU for (%j, %j, %j)', (product, colour, size) => {
    expect(() => buildSku(product, colour, size)).toThrow(RangeError)
  })
})
