import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { customerIdOf, customerOrStaffCreate, ownScopedRead, ownScopedWrite } from '@/access'

/**
 * Stamp the owning customer from the session, never from the payload.
 *
 * A customer could otherwise post `{ customer: <someone else's id> }` and write a row into
 * another account. Staff keep whatever they set, because an agent legitimately edits a
 * customer's address on a support call.
 */
const stampOwner: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation !== 'create') return data

  const customerId = customerIdOf(req.user)
  return customerId === null ? data : { ...data, customer: customerId }
}

/**
 * The customer address book.
 *
 * `state` is not cosmetic: it decides whether an order is taxed as CGST+SGST (same state as
 * the seller) or IGST (across states), so it is a required select rather than free text —
 * "Karnataka" and "karnataka " must not be two different tax outcomes.
 */
export const Addresses: CollectionConfig = {
  slug: 'addresses',
  access: {
    read: ownScopedRead({ resource: 'customers', ownerField: 'customer' }),
    create: customerOrStaffCreate('customers'),
    update: ownScopedWrite({ resource: 'customers', ownerField: 'customer' }),
    delete: ownScopedWrite({ resource: 'customers', ownerField: 'customer' }),
  },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'customer', 'city', 'state', 'pincode'],
    group: 'People',
  },
  hooks: {
    beforeChange: [stampOwner],
  },
  fields: [
    { name: 'customer', type: 'relationship', relationTo: 'customers', required: true, index: true },
    {
      name: 'label',
      type: 'text',
      required: true,
      defaultValue: 'Home',
      admin: { description: 'How the customer recognises it — Home, Office.' },
    },
    { name: 'name', type: 'text', required: true, admin: { description: 'Recipient name.' } },
    { name: 'phone', type: 'text', required: true },
    { name: 'line1', type: 'text', required: true },
    { name: 'line2', type: 'text' },
    { name: 'city', type: 'text', required: true },
    {
      name: 'state',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Decides CGST+SGST vs IGST at checkout.' },
    },
    {
      name: 'pincode',
      type: 'text',
      required: true,
      index: true,
      validate: (value: string | null | undefined) =>
        typeof value === 'string' && /^[1-9][0-9]{5}$/.test(value)
          ? true
          : 'Enter a six-digit Indian PIN code.',
    },
    { name: 'country', type: 'text', required: true, defaultValue: 'India' },
    { name: 'isDefault', type: 'checkbox', defaultValue: false },
  ],
}
