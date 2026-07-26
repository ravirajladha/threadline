import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { customerIdOf, customerOrStaffCreate, ownScopedRead, ownScopedWrite } from '@/access'

const stampOwner: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation !== 'create') return data

  const customerId = customerIdOf(req.user)
  return customerId === null ? data : { ...data, customer: customerId }
}

/**
 * Saved variants, and the back-in-stock queue.
 *
 * Kept at variant level rather than product level because "I want this shirt" is not
 * actionable — "I want this shirt in navy, medium" is, and it is the only form that lets the
 * restock alert say something true. `notifyOnRestock` turns the row into a subscription the
 * scheduler reads when stock crosses back above zero.
 */
export const Wishlists: CollectionConfig = {
  slug: 'wishlists',
  access: {
    read: ownScopedRead({ resource: 'customers', ownerField: 'customer' }),
    create: customerOrStaffCreate('customers'),
    update: ownScopedWrite({ resource: 'customers', ownerField: 'customer' }),
    delete: ownScopedWrite({ resource: 'customers', ownerField: 'customer' }),
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['customer', 'variant', 'notifyOnRestock', 'createdAt'],
    group: 'Engagement',
  },
  hooks: {
    beforeChange: [stampOwner],
  },
  indexes: [{ fields: ['customer', 'variant'], unique: true }],
  fields: [
    { name: 'customer', type: 'relationship', relationTo: 'customers', required: true, index: true },
    { name: 'variant', type: 'relationship', relationTo: 'variants', required: true, index: true },
    {
      name: 'notifyOnRestock',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'Email and WhatsApp the customer when this variant is back in stock.' },
    },
  ],
}
