import type { CollectionConfig } from 'payload'

import { ownScopedRead, staffWrite } from '@/access'
import { returnStatusEndpoint } from '@/endpoints/returns'
import { moneyField } from './fields'
import { RETURN_STATUSES, RETURN_TYPES } from '@/types'

/**
 * A return or a size exchange.
 *
 * Clothing runs 20–40% returns, so this is a designed flow rather than a support ticket with
 * a refund attached. The important field is `exchangeVariant`: the common case is not "I don't
 * want it" but "I want the next size up", and an exchange keeps the sale, keeps the customer,
 * and skips the refund entirely.
 *
 * A customer may raise one and read their own; only a role with `refunds` may approve one or
 * set the refund amount. `support_agent` can see every return and approve none.
 */
export const Returns: CollectionConfig = {
  slug: 'returns',
  access: {
    read: ownScopedRead({ resource: 'orders', ownerField: 'order.customer' }),
    /**
     * Staff only — a customer raises a return through `/api/returns`, never through this
     * collection's own REST route.
     *
     * It was `customerOrStaffCreate('refunds')` until the J8 security pass, and this was the worse
     * cousin of the hole J7 found in `tickets`. Payload exposes `POST /api/returns` whatever our
     * routes do, and unlike tickets there is **no owner hook here at all** — ownership is derived
     * from `order.customer`, so nothing stopped a signed-in customer creating a return against
     * *somebody else's order id*, with a `status` of their choosing and a `refundAmount` they set
     * themselves. An ops queue would show a legitimate-looking refund request against a real order
     * belonging to a real customer (OWASP A01 and A04).
     *
     * Read scoping already went through `order.customer`, so they could not read it back — which is
     * precisely what made it quiet.
     */
    create: staffWrite('refunds'),
    update: staffWrite('refunds'),
    delete: staffWrite('refunds'),
  },
  endpoints: [returnStatusEndpoint],
  admin: {
    useAsTitle: 'status',
    defaultColumns: ['order', 'type', 'status', 'refundAmount', 'createdAt'],
    group: 'Commerce',
  },
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'return',
      options: RETURN_TYPES.map((value) => ({ label: value, value })),
    },
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'orderItem', type: 'relationship', relationTo: 'orderItems', required: true },
        { name: 'qty', type: 'number', required: true, min: 1 },
        {
          name: 'reason',
          type: 'select',
          required: true,
          options: [
            { label: 'Too small', value: 'too_small' },
            { label: 'Too large', value: 'too_large' },
            { label: 'Not as described', value: 'not_as_described' },
            { label: 'Damaged or defective', value: 'damaged' },
            { label: 'Wrong item sent', value: 'wrong_item' },
            { label: 'Changed my mind', value: 'changed_mind' },
          ],
          admin: { description: 'Fit reasons feed the “runs small” hint on the product page.' },
        },
      ],
    },
    {
      name: 'exchangeVariant',
      type: 'relationship',
      relationTo: 'variants',
      admin: {
        condition: (data) => data?.type === 'exchange',
        description: 'The size or colour the customer wants instead.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'requested',
      index: true,
      options: RETURN_STATUSES.map((value) => ({ label: value, value })),
      admin: { position: 'sidebar' },
    },
    moneyField('refundAmount', { description: 'Set when the return is approved.' }),
    { name: 'pickupAwb', type: 'text', admin: { description: 'Reverse-pickup tracking number.' } },
    {
      name: 'customerNote',
      type: 'textarea',
      admin: { description: 'What the customer told us. Visible to them.' },
    },
    {
      name: 'adminNote',
      type: 'textarea',
      access: { read: ({ req }) => req.user?.collection === 'users' },
      admin: { description: 'Internal. Never shown to the customer.' },
    },
  ],
}
