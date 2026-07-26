import { describe, expect, it } from 'vitest'

import {
  VARIANT_CSV_COLUMNS,
  exportVariantsCsv,
  parseVariantCsv,
  toVariantCsvRow,
  type ExportableVariant,
} from '@/lib/csv/catalogCsv'
import { parseCsv } from '@/lib/csv/csv'

const VARIANT: ExportableVariant = {
  sku: 'OXFORDSHIRT-MIDNI-M',
  productTitle: 'Kestrel Oxford Shirt',
  categoryTitle: 'Shirts',
  sizeLabel: 'M',
  colourName: 'Midnight Navy',
  pricePaise: 189900,
  compareAtPricePaise: 249900,
  stockQty: 12,
  reservedQty: 2,
  weightGrams: 260,
  barcode: '8901234567890',
  isActive: true,
}

describe('toVariantCsvRow', () => {
  it('renders money in rupees, because a spreadsheet is a render boundary', () => {
    const row = toVariantCsvRow(VARIANT)
    expect(row.priceRupees).toBe('1899.00')
    expect(row.compareAtPriceRupees).toBe('2499.00')
  })

  it('leaves an absent amount empty rather than writing 0.00', () => {
    const row = toVariantCsvRow({ ...VARIANT, compareAtPricePaise: null })
    expect(row.compareAtPriceRupees).toBe('')
  })

  it('writes the active flag as yes or no', () => {
    expect(toVariantCsvRow(VARIANT).isActive).toBe('yes')
    expect(toVariantCsvRow({ ...VARIANT, isActive: false }).isActive).toBe('no')
  })

  it('writes a zero stock figure as 0, not as empty', () => {
    expect(toVariantCsvRow({ ...VARIANT, stockQty: 0 }).stockQty).toBe('0')
  })
})

describe('exportVariantsCsv', () => {
  it('emits every declared column in order', () => {
    const parsed = parseCsv(exportVariantsCsv([VARIANT]))
    expect(Object.keys(parsed[0]!)).toEqual([...VARIANT_CSV_COLUMNS])
  })

  it('quotes a product title containing a comma', () => {
    const csv = exportVariantsCsv([{ ...VARIANT, productTitle: 'Shirt, Oxford' }])
    expect(csv).toContain('"Shirt, Oxford"')
    expect(parseCsv(csv)[0]!.product).toBe('Shirt, Oxford')
  })

  it('emits a header-only file for an empty catalog', () => {
    expect(parseCsv(exportVariantsCsv([]))).toEqual([])
  })
})

describe('parseVariantCsv', () => {
  it('converts rupees back to paise', () => {
    const { updates, errors } = parseVariantCsv('sku,priceRupees\r\nA-1,1899.00\r\n')

    expect(errors).toEqual([])
    expect(updates[0]!.pricePaise).toBe(189900)
  })

  it('rounds a sub-paise amount rather than storing a float', () => {
    const { updates } = parseVariantCsv('sku,priceRupees\r\nA-1,499.995\r\n')
    expect(updates[0]!.pricePaise).toBe(50000)
  })

  it('accepts what a spreadsheet actually produces', () => {
    const { updates, errors } = parseVariantCsv('sku,priceRupees\r\nA-1,"₹1,899.00"\r\n')

    expect(errors).toEqual([])
    expect(updates[0]!.pricePaise).toBe(189900)
  })

  it('survives a round trip through export', () => {
    const { updates, errors } = parseVariantCsv(exportVariantsCsv([VARIANT]))

    expect(errors).toEqual([])
    expect(updates[0]).toEqual({
      sku: 'OXFORDSHIRT-MIDNI-M',
      pricePaise: 189900,
      compareAtPricePaise: 249900,
      weightGrams: 260,
      barcode: '8901234567890',
      isActive: true,
      targetStockQty: 12,
    })
  })

  it('reads stock as a target, for the importer to turn into a movement', () => {
    const { updates } = parseVariantCsv('sku,stockQty\r\nA-1,0\r\n')
    expect(updates[0]!.targetStockQty).toBe(0)
  })

  it('leaves an omitted stock column null so the import does not zero the shelf', () => {
    // A file without a stockQty column must not be read as "set everything to zero".
    const { updates } = parseVariantCsv('sku,priceRupees\r\nA-1,100.00\r\n')
    expect(updates[0]!.targetStockQty).toBeNull()
  })

  it('does not let an import move a variant to another product', () => {
    // Those columns are context for the reader. Honouring them would silently rewrite the
    // meaning of every order line already pointing at the variant.
    const { updates } = parseVariantCsv('sku,product,size\r\nA-1,Something Else,XXL\r\n')
    expect(updates[0]).not.toHaveProperty('productTitle')
    expect(Object.keys(updates[0]!)).not.toContain('size')
  })

  describe('validation', () => {
    it('reports every bad row instead of stopping at the first', () => {
      const { errors } = parseVariantCsv(
        'sku,priceRupees,weightGrams\r\nA-1,abc,260\r\nA-2,100.00,-4\r\nA-3,xyz,10\r\n',
      )

      expect(errors).toHaveLength(3)
      expect(errors.map((e) => e.line)).toEqual([2, 3, 4])
    })

    it('names the column and the spreadsheet line', () => {
      const { errors } = parseVariantCsv('sku,priceRupees\r\nA-1,abc\r\n')
      expect(errors[0]).toMatchObject({ line: 2, column: 'priceRupees' })
    })

    it('does not apply a row that failed validation', () => {
      const { updates } = parseVariantCsv('sku,priceRupees\r\nA-1,abc\r\nA-2,100.00\r\n')

      expect(updates).toHaveLength(1)
      expect(updates[0]!.sku).toBe('A-2')
    })

    it('rejects a row with no SKU to match on', () => {
      const { updates, errors } = parseVariantCsv('sku,priceRupees\r\n,100.00\r\n')

      expect(updates).toHaveLength(0)
      expect(errors[0]).toMatchObject({ line: 2, column: 'sku' })
    })

    it('rejects a duplicated SKU rather than applying whichever row came last', () => {
      const { updates, errors } = parseVariantCsv(
        'sku,priceRupees\r\nA-1,100.00\r\nA-1,200.00\r\n',
      )

      expect(updates).toHaveLength(1)
      expect(errors[0]!.message).toContain('more than once')
    })

    it('rejects a negative price', () => {
      const { errors } = parseVariantCsv('sku,priceRupees\r\nA-1,-100\r\n')
      expect(errors).toHaveLength(1)
    })

    it('rejects a fractional stock quantity', () => {
      const { errors } = parseVariantCsv('sku,stockQty\r\nA-1,2.5\r\n')
      expect(errors[0]).toMatchObject({ column: 'stockQty' })
    })

    it.each(['yes', 'y', 'TRUE', '1', 'active'])('reads %j as active', (value) => {
      expect(parseVariantCsv(`sku,isActive\r\nA-1,${value}\r\n`).updates[0]!.isActive).toBe(true)
    })

    it.each(['no', 'n', 'FALSE', '0', 'inactive'])('reads %j as inactive', (value) => {
      expect(parseVariantCsv(`sku,isActive\r\nA-1,${value}\r\n`).updates[0]!.isActive).toBe(false)
    })

    it('rejects an unrecognised active value rather than guessing', () => {
      const { errors } = parseVariantCsv('sku,isActive\r\nA-1,maybe\r\n')
      expect(errors[0]).toMatchObject({ column: 'isActive' })
    })

    it('reports a malformed file once, without a stack trace', () => {
      const { updates, errors } = parseVariantCsv('sku,priceRupees\r\nA-1\r\n')

      expect(updates).toEqual([])
      expect(errors).toHaveLength(1)
      expect(errors[0]!.column).toBe('file')
    })

    it('accepts an empty file as no work to do', () => {
      expect(parseVariantCsv('')).toEqual({ updates: [], errors: [] })
    })
  })
})
