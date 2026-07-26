import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'

import { denyAll, staffRead, staffWrite } from '@/access'
import { createPayloadLedgerPort } from '@/lib/inventory/payloadLedger'
import { signedQty } from '@/lib/inventory/stock'
import { syncVariantStock } from '@/lib/inventory/syncStock'
import { STOCK_MOVEMENT_TYPES } from '@/types'

/**
 * Recalculate the owning variant's `stockQty` from its whole ledger.
 *
 * `req` is threaded into the port deliberately — this hook runs inside the transaction that is
 * creating the movement, and a query that does not join that transaction cannot see the new row.
 */
const recalculateVariantStock: CollectionAfterChangeHook = async ({ doc, req }) => {
  const variantId = typeof doc.variant === 'object' ? doc.variant?.id : doc.variant
  if (variantId === undefined || variantId === null) return doc

  await syncVariantStock(createPayloadLedgerPort(req.payload, req), variantId)

  return doc
}

/**
 * The append-only stock ledger. Every unit that enters or leaves the warehouse is a row.
 *
 * Nothing here is ever updated or deleted — `update` and `delete` are denied to every role
 * including super_admin, which is the point: a stock discrepancy must always be explainable
 * from the rows, and a correction is another row (`adjust`) with a reason attached. This is
 * also OWASP A08: an immutable ledger is what makes a double-processed webhook detectable.
 */
export const StockMovements: CollectionConfig = {
  slug: 'stockMovements',
  access: {
    read: staffRead('catalog'),
    create: staffWrite('catalog'),
    update: denyAll,
    delete: denyAll,
  },
  admin: {
    useAsTitle: 'reason',
    defaultColumns: ['variant', 'type', 'qty', 'reason', 'createdAt'],
    group: 'Catalog',
    description: 'Append-only. Rows cannot be edited or deleted — correct a mistake with an “adjust”.',
  },
  hooks: {
    afterChange: [recalculateVariantStock],
  },
  fields: [
    { name: 'variant', type: 'relationship', relationTo: 'variants', required: true, index: true },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: STOCK_MOVEMENT_TYPES.map((value) => ({ label: value, value })),
      admin: {
        description:
          '“in” and “return” add stock, “out” and “damage” remove it, “adjust” applies the sign you enter.',
      },
    },
    {
      name: 'qty',
      type: 'number',
      required: true,
      admin: { description: 'Units moved. Negative is only meaningful for “adjust”.' },
      validate: (value: number | null | undefined) =>
        typeof value === 'number' && value !== 0 ? true : 'A movement of zero units is not a movement.',
    },
    {
      name: 'reason',
      type: 'text',
      required: true,
      admin: { description: 'Why the stock moved — “Supplier delivery #4412”, “Stock count correction”.' },
    },
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      index: true,
      admin: { description: 'Set automatically when the movement came from an order.' },
    },
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
      admin: { description: 'Who made the movement. Blank means the system did.' },
    },
    {
      name: 'effect',
      type: 'number',
      virtual: true,
      admin: {
        readOnly: true,
        description: 'The signed effect this row has on stock.',
      },
      hooks: {
        afterRead: [({ siblingData }) => signedQty({ type: siblingData.type, qty: siblingData.qty ?? 0 })],
      },
    },
  ],
}
