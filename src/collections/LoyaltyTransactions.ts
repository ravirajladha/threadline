import type { CollectionConfig } from 'payload'

import { denyAll, ownScopedRead } from '@/access'
import { LOYALTY_TRANSACTION_TYPES } from '@/types'

/**
 * The points ledger.
 *
 * `customers.loyaltyPoints` is a cached balance; this is the truth behind it, for the same
 * reason stock is a ledger and not a number — points are money-adjacent, and "you had 340
 * points and now you have 90" needs rows to answer.
 *
 * Written only by the server: points are earned when an order is *delivered*, not when it is
 * placed, and reversed when it comes back. Letting the API create rows here would be letting
 * a client mint currency (OWASP A04).
 */
export const LoyaltyTransactions: CollectionConfig = {
  slug: 'loyaltyTransactions',
  access: {
    read: ownScopedRead({ resource: 'orders', ownerField: 'customer' }),
    create: denyAll,
    update: denyAll,
    delete: denyAll,
  },
  admin: {
    useAsTitle: 'type',
    defaultColumns: ['customer', 'type', 'points', 'order', 'expiresAt'],
    group: 'Commerce',
    description: 'Append-only. The customer’s balance is the sum of these rows.',
  },
  fields: [
    { name: 'customer', type: 'relationship', relationTo: 'customers', required: true, index: true },
    { name: 'order', type: 'relationship', relationTo: 'orders', index: true },
    {
      name: 'points',
      type: 'number',
      required: true,
      admin: { description: 'Signed. Positive to award, negative to redeem or reverse.' },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: LOYALTY_TRANSACTION_TYPES.map((value) => ({ label: value, value })),
    },
    {
      name: 'expiresAt',
      type: 'date',
      index: true,
      admin: { description: 'Earned points expire a year out. Swept by the scheduler.' },
    },
  ],
}
