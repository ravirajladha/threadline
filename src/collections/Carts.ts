import type { CollectionConfig } from 'payload'

import { denyAll, ownScopedRead, ownScopedWrite } from '@/access'
import { moneyField } from './fields'

/**
 * The shopping cart, stored in the database rather than a cookie.
 *
 * A guest cart is keyed by `sessionId` and adopted by the customer on login (J4), so a
 * customer who browses signed-out and then signs in does not watch their cart empty itself.
 * Server-side storage is also what makes abandoned-cart recovery and stock reservation
 * possible at all — neither works if the only copy lives in the browser.
 *
 * `priceAtAdd` records what the customer saw. Checkout re-prices from the variant and the
 * server's number wins (OWASP A04); the stored figure is there to explain a difference, not
 * to be trusted as the total.
 */
export const Carts: CollectionConfig = {
  slug: 'carts',
  access: {
    read: ownScopedRead({ resource: 'orders', ownerField: 'customer' }),
    // Guest carts are created server-side against the session cookie, never by a raw API call.
    create: denyAll,
    update: ownScopedWrite({ resource: 'orders', ownerField: 'customer' }),
    delete: ownScopedWrite({ resource: 'orders', ownerField: 'customer' }),
  },
  admin: {
    useAsTitle: 'sessionId',
    defaultColumns: ['sessionId', 'customer', 'updatedAt', 'expiresAt'],
    group: 'Commerce',
  },
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      index: true,
      admin: { description: 'Empty while the shopper is a guest.' },
    },
    {
      name: 'sessionId',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Opaque cookie value. The only handle a guest cart has.' },
    },
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'variant', type: 'relationship', relationTo: 'variants', required: true },
        { name: 'qty', type: 'number', required: true, min: 1 },
        moneyField('priceAtAdd', {
          required: true,
          description: 'What the shopper saw when they added it. Checkout re-prices from the variant.',
        }),
      ],
    },
    { name: 'coupon', type: 'relationship', relationTo: 'coupons' },
    {
      name: 'expiresAt',
      type: 'date',
      index: true,
      admin: { description: 'Swept by the scheduler. Releases any reserved stock.' },
    },
    {
      name: 'abandonedNotifiedAt',
      type: 'date',
      admin: { description: 'Set when the recovery email went out, so it only goes out once.' },
    },
  ],
}
