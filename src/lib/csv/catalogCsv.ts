/**
 * Mapping between catalog variants and CSV rows.
 *
 * Exported at **variant** level rather than product level, because the variant is the sellable
 * unit — a price, a stock figure and a SKU all belong to one size in one colour, and a
 * product-level export cannot represent them without inventing a column-per-size scheme that
 * breaks the moment a size is added.
 *
 * Money crosses this boundary in **rupees**. Paise is the internal representation; a
 * spreadsheet is a render boundary, and an owner typing `1899.00` should not have to know the
 * system counts in paise. `Money` does the conversion and the rounding, so the float never
 * survives past parsing.
 *
 * Import collects every row's problems instead of throwing on the first. Someone importing 500
 * rows needs the whole list, not to fix one typo, re-upload, and discover the next.
 */
import { Money } from '@/lib/pricing/money'
import { parseCsv, toCsv } from './csv'

export const VARIANT_CSV_COLUMNS = [
  'sku',
  'product',
  'category',
  'size',
  'colour',
  'priceRupees',
  'compareAtPriceRupees',
  'stockQty',
  'reservedQty',
  'weightGrams',
  'barcode',
  'isActive',
] as const

export type VariantCsvColumn = (typeof VARIANT_CSV_COLUMNS)[number]
export type VariantCsvRow = Record<VariantCsvColumn, string>

/** The shape the exporter needs. Loose on purpose — the endpoint resolves the relationships. */
export interface ExportableVariant {
  sku: string
  productTitle: string
  categoryTitle: string
  sizeLabel: string
  colourName: string
  pricePaise: number | null
  compareAtPricePaise: number | null
  stockQty: number
  reservedQty: number
  weightGrams: number | null
  barcode: string | null
  isActive: boolean
}

/** Fields an import is allowed to change. Everything else is identity or derived. */
export interface VariantCsvUpdate {
  sku: string
  pricePaise: number | null
  compareAtPricePaise: number | null
  weightGrams: number | null
  barcode: string | null
  isActive: boolean
  /** Desired stock. The importer turns this into a ledger movement — never a direct write. */
  targetStockQty: number | null
}

export interface RowError {
  /** Line number as the owner sees it in their spreadsheet — header is line 1. */
  line: number
  column: string
  message: string
}

export interface ParsedVariantCsv {
  updates: VariantCsvUpdate[]
  errors: RowError[]
}

// --- Export -----------------------------------------------------------------

function rupees(paise: number | null): string {
  return paise === null ? '' : Money.fromPaise(paise).toRupees().toFixed(2)
}

export function toVariantCsvRow(variant: ExportableVariant): VariantCsvRow {
  return {
    sku: variant.sku,
    product: variant.productTitle,
    category: variant.categoryTitle,
    size: variant.sizeLabel,
    colour: variant.colourName,
    priceRupees: rupees(variant.pricePaise),
    compareAtPriceRupees: rupees(variant.compareAtPricePaise),
    stockQty: String(variant.stockQty),
    reservedQty: String(variant.reservedQty),
    weightGrams: variant.weightGrams === null ? '' : String(variant.weightGrams),
    barcode: variant.barcode ?? '',
    isActive: variant.isActive ? 'yes' : 'no',
  }
}

export function exportVariantsCsv(variants: readonly ExportableVariant[]): string {
  return toCsv(variants.map(toVariantCsvRow), VARIANT_CSV_COLUMNS)
}

// --- Import -----------------------------------------------------------------

function parseMoney(raw: string, column: string, line: number, errors: RowError[]): number | null {
  const value = raw.trim()
  if (value === '') return null

  // Tolerate what a spreadsheet actually produces: "₹1,899.00".
  const cleaned = value.replace(/[₹,\s]/g, '')
  const amount = Number(cleaned)

  if (!Number.isFinite(amount) || amount < 0) {
    errors.push({ line, column, message: `“${raw}” is not a valid amount in rupees.` })
    return null
  }

  return Money.fromRupees(amount).toPaise()
}

function parseInteger(
  raw: string,
  column: string,
  line: number,
  errors: RowError[],
): number | null {
  const value = raw.trim()
  if (value === '') return null

  const amount = Number(value)
  if (!Number.isInteger(amount) || amount < 0) {
    errors.push({ line, column, message: `“${raw}” must be a whole number of zero or more.` })
    return null
  }

  return amount
}

const TRUTHY = new Set(['yes', 'y', 'true', '1', 'active'])
const FALSY = new Set(['no', 'n', 'false', '0', 'inactive'])

function parseBoolean(raw: string, column: string, line: number, errors: RowError[]): boolean {
  const value = raw.trim().toLowerCase()
  if (value === '') return true
  if (TRUTHY.has(value)) return true
  if (FALSY.has(value)) return false

  errors.push({ line, column, message: `“${raw}” is not yes or no.` })
  return true
}

/**
 * Parse an uploaded catalog CSV into the updates it implies.
 *
 * Matches on `sku`, which is why the export includes it and why the SKU is generated once and
 * left alone: it is the identity that survives a round trip through a spreadsheet.
 *
 * Note what is *not* importable — the product, category, size and colour columns are context
 * for whoever is reading the file. Letting an import move a variant to another product would
 * silently rewrite the meaning of every order line already pointing at it.
 */
export function parseVariantCsv(text: string): ParsedVariantCsv {
  const errors: RowError[] = []

  let records: Array<Record<string, string>>
  try {
    records = parseCsv(text)
  } catch (error) {
    return {
      updates: [],
      errors: [
        {
          line: 0,
          column: 'file',
          message: error instanceof Error ? error.message : 'The file could not be read as CSV.',
        },
      ],
    }
  }

  const updates: VariantCsvUpdate[] = []
  const seen = new Set<string>()

  records.forEach((record, index) => {
    const line = index + 2 // header occupies line 1
    const sku = (record.sku ?? '').trim()

    if (sku === '') {
      errors.push({ line, column: 'sku', message: 'Every row needs a SKU to match on.' })
      return
    }

    if (seen.has(sku)) {
      errors.push({ line, column: 'sku', message: `${sku} appears more than once in this file.` })
      return
    }
    seen.add(sku)

    const before = errors.length

    const update: VariantCsvUpdate = {
      sku,
      pricePaise: parseMoney(record.priceRupees ?? '', 'priceRupees', line, errors),
      compareAtPricePaise: parseMoney(
        record.compareAtPriceRupees ?? '',
        'compareAtPriceRupees',
        line,
        errors,
      ),
      weightGrams: parseInteger(record.weightGrams ?? '', 'weightGrams', line, errors),
      barcode: (record.barcode ?? '').trim() || null,
      isActive: parseBoolean(record.isActive ?? '', 'isActive', line, errors),
      targetStockQty: parseInteger(record.stockQty ?? '', 'stockQty', line, errors),
    }

    // A row that produced an error is not applied — a half-imported row is worse than a
    // rejected one, because nobody can tell afterwards which half landed.
    if (errors.length === before) updates.push(update)
  })

  return { updates, errors }
}
