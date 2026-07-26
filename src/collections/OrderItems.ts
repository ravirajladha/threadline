import type { CollectionConfig } from 'payload'

import { denyAll, ownScopedRead } from '@/access'
import { moneyField } from './fields'

/**
 * One line of an order, snapshotted in full.
 *
 * Every display field is copied — title, size label, colour name, image, unit price, tax rate.
 * `variant` is kept as a reference for reporting and returns, but nothing on an invoice is
 * ever read through it. A product renamed, repriced or archived next month must not silently
 * rewrite an order placed today; a customer's receipt has to keep saying what they bought.
 *
 * Immutable through the API: lines are written server-side with the order and never edited.
 */
export const OrderItems: CollectionConfig = {
  slug: 'orderItems',
  access: {
    read: ownScopedRead({ resource: 'orders', ownerField: 'order.customer' }),
    create: denyAll,
    update: denyAll,
    delete: denyAll,
  },
  admin: {
    useAsTitle: 'productTitle',
    defaultColumns: ['order', 'sku', 'productTitle', 'qty', 'lineTotal'],
    group: 'Commerce',
    description: 'A frozen copy of what was bought. Not editable.',
  },
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    {
      name: 'variant',
      type: 'relationship',
      relationTo: 'variants',
      index: true,
      admin: { description: 'Reference only — for returns and reporting. Never read for display.' },
    },
    { name: 'sku', type: 'text', required: true, index: true },
    { name: 'productTitle', type: 'text', required: true },
    { name: 'sizeLabel', type: 'text', required: true },
    { name: 'colourName', type: 'text', required: true },
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'qty', type: 'number', required: true, min: 1 },
    moneyField('unitPrice', { required: true }),
    { name: 'taxRatePct', type: 'number', required: true },
    moneyField('taxAmount', { required: true }),
    moneyField('lineTotal', { required: true, description: 'unitPrice × qty, plus tax.' }),
  ],
}
