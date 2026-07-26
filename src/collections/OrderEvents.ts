import type { CollectionConfig } from 'payload'

import { denyAll, ownScopedRead } from '@/access'
import { ORDER_STATUSES } from '@/types'

/**
 * The audit trail behind an order's status.
 *
 * Every transition writes a row here, which is what turns "why is this order still pending?"
 * from guesswork into a query. It also satisfies OWASP A09: payment and refund events are
 * logged with who or what caused them, and — deliberately — nothing else. `note` must never
 * carry card data, tokens or a full address.
 *
 * Append-only, like the stock ledger: no role can edit or delete a row.
 */
export const OrderEvents: CollectionConfig = {
  slug: 'orderEvents',
  access: {
    read: ownScopedRead({ resource: 'orders', ownerField: 'order.customer' }),
    create: denyAll,
    update: denyAll,
    delete: denyAll,
  },
  admin: {
    useAsTitle: 'toStatus',
    defaultColumns: ['order', 'fromStatus', 'toStatus', 'source', 'createdAt'],
    group: 'Commerce',
    description: 'Append-only status history. Drives the customer’s order timeline.',
  },
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    {
      name: 'fromStatus',
      type: 'select',
      options: ORDER_STATUSES.map((value) => ({ label: value, value })),
      admin: { description: 'Empty for the first event, when the order was created.' },
    },
    {
      name: 'toStatus',
      type: 'select',
      required: true,
      options: ORDER_STATUSES.map((value) => ({ label: value, value })),
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      defaultValue: 'system',
      options: [
        { label: 'staff', value: 'staff' },
        { label: 'customer', value: 'customer' },
        { label: 'webhook', value: 'webhook' },
        { label: 'system', value: 'system' },
      ],
    },
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
      admin: { description: 'Set when a staff member caused the change.' },
    },
    {
      name: 'note',
      type: 'text',
      admin: { description: 'Short reason. Never put payment details or PII here.' },
    },
  ],
}
