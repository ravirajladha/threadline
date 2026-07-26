import type { CollectionConfig } from 'payload'

import { customerOrStaffCreate, ownScopedRead, staffWrite } from '@/access'
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
    create: customerOrStaffCreate('refunds'),
    update: staffWrite('refunds'),
    delete: staffWrite('refunds'),
  },
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
