import type { CollectionBeforeValidateHook, CollectionConfig, PayloadRequest } from 'payload'

import { publicReadStaffWrite } from '@/access'
import { adjustStockEndpoint } from '@/endpoints/adjustStock'
import { exportCatalogCsvEndpoint, importCatalogCsvEndpoint } from '@/endpoints/catalogCsvEndpoints'
import { buildSku } from '@/lib/inventory/sku'
import { isActiveField, moneyField, serverOwned } from './fields'

type LabelSource = 'products' | 'colours' | 'sizes'

/**
 * Read one text field from a relationship that may arrive either as a bare id (REST, the
 * seed script) or as an already-populated document (the admin panel). Both are normal, so
 * the hook handles both rather than forcing callers into one shape.
 */
async function relatedLabel(
  value: unknown,
  collection: LabelSource,
  field: 'title' | 'name' | 'label',
  req: PayloadRequest,
): Promise<string> {
  if (value !== null && typeof value === 'object') {
    const populated = (value as Record<string, unknown>)[field]
    if (typeof populated === 'string') return populated
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const doc = await req.payload.findByID({ collection, id: value, depth: 0 })
    const resolved = (doc as unknown as Record<string, unknown>)[field]
    if (typeof resolved === 'string') return resolved
  }

  throw new Error(`Cannot resolve ${collection}.${field} for SKU generation`)
}

/**
 * Generate the SKU when the editor has not supplied one.
 *
 * Create only. A SKU that has already been printed on a picking slip must not change
 * underneath the warehouse, so an existing value is never regenerated.
 */
const generateSku: CollectionBeforeValidateHook = async ({ data, operation, req }) => {
  if (!data) return data
  if (operation !== 'create') return data
  if (typeof data.sku === 'string' && data.sku.length > 0) return data

  const [product, colour, size] = await Promise.all([
    relatedLabel(data.product, 'products', 'title', req),
    relatedLabel(data.colour, 'colours', 'name', req),
    relatedLabel(data.size, 'sizes', 'label', req),
  ])

  return { ...data, sku: buildSku(product, colour, size) }
}

/**
 * A variant is the sellable unit — one size, in one colour, of one product.
 *
 * Everything downstream keys off this row: the cart holds variant ids, stock is counted per
 * variant, and an order item snapshots one. The unique constraint on (product, size, colour)
 * is what guarantees the size × colour matrix has exactly one cell per combination — without
 * it a duplicated row splits the stock of a single real garment across two records.
 *
 * `stockQty` is derived from the `stockMovements` ledger and never authored: see
 * `src/lib/inventory/stock.ts`. `reservedQty` is held by in-progress checkouts (J4).
 */
export const Variants: CollectionConfig = {
  slug: 'variants',
  access: publicReadStaffWrite,
  admin: {
    useAsTitle: 'sku',
    defaultColumns: ['sku', 'product', 'size', 'colour', 'stockQty', 'isActive'],
    group: 'Catalog',
    description: 'This is what sells. Adjust stock through Stock Movements, never here.',
  },
  indexes: [{ fields: ['product', 'size', 'colour'], unique: true }],
  // Order matters: the literal paths must be registered before `/:id/…` so that
  // `/variants/export-csv` is not matched as a variant whose id is "export-csv".
  endpoints: [exportCatalogCsvEndpoint, importCatalogCsvEndpoint, adjustStockEndpoint],
  hooks: {
    beforeValidate: [generateSku],
  },
  fields: [
    {
      name: 'stockAdjuster',
      type: 'ui',
      admin: {
        components: { Field: '@/components/admin/StockAdjuster#StockAdjuster' },
        condition: (data) => Boolean(data?.id),
      },
    },
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
    },
    { name: 'size', type: 'relationship', relationTo: 'sizes', required: true, index: true },
    { name: 'colour', type: 'relationship', relationTo: 'colours', required: true, index: true },
    {
      name: 'sku',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Generated as PRODUCT-COLOUR-SIZE on create. Changing it after picking has started will confuse the warehouse.',
      },
    },
    moneyField('price', { description: 'Overrides the product MRP for this variant only.' }),
    moneyField('compareAtPrice', { description: 'Shown struck through beside the price.' }),
    {
      name: 'stockQty',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        readOnly: serverOwned.readOnly,
        description: 'Sum of this variant’s stock movements. Add a movement to change it.',
      },
    },
    {
      name: 'reservedQty',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        readOnly: serverOwned.readOnly,
        description: 'Units held by checkouts in progress. Available to sell = stock − reserved.',
      },
    },
    { name: 'barcode', type: 'text' },
    {
      name: 'weightGrams',
      type: 'number',
      min: 0,
      admin: { description: 'Required by Shiprocket to rate a shipment.' },
    },
    isActiveField(),
  ],
}
