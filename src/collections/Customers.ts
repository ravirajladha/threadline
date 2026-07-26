import type { CollectionConfig, FieldAccess } from 'payload'

import { customerSelfOrStaff, customerSelfOrStaffWrite, isStaff, staffWrite } from '@/access'
import { serverOwned } from './fields'

/** Balances and verification flags are earned, not claimed. Staff-writable, customer-readable. */
const staffOnlyField: FieldAccess = ({ req }) => isStaff(req.user)

/**
 * Storefront accounts — a second auth collection, deliberately separate from `users`.
 *
 * The separation is structural rather than conventional: a customer session carries a
 * different `collection`, so no amount of tampering with a storefront token produces a staff
 * role, and `admin.user` points at `users` only, so a customer cannot reach /admin at all.
 *
 * Access is self-scoped — `customerSelfOrStaff` resolves to `{ id: { equals: me } }`, which
 * Payload folds into the query, so another customer's row is never fetched in the first place.
 */
export const Customers: CollectionConfig = {
  slug: 'customers',
  access: {
    read: customerSelfOrStaff,
    // Public registration. Rate limiting lands with the storefront auth routes in J8.
    create: () => true,
    update: customerSelfOrStaffWrite,
    delete: staffWrite('customers'),
    admin: () => false,
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'phone', 'loyaltyPoints'],
    group: 'People',
  },
  auth: {
    tokenExpiration: 60 * 60 * 24 * 30,
    maxLoginAttempts: 10,
    lockTime: 10 * 60 * 1000,
    cookies: {
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'phone',
      type: 'text',
      index: true,
      admin: { description: 'Ten digits, used for delivery updates and WhatsApp.' },
    },
    {
      name: 'whatsappOptIn',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Consent for WhatsApp order updates. Never assume it.' },
    },
    {
      name: 'loyaltyPoints',
      type: 'number',
      defaultValue: 0,
      access: { update: staffOnlyField },
      admin: {
        readOnly: serverOwned.readOnly,
        description: 'Balance derived from loyalty transactions. Never edited directly.',
      },
    },
    {
      name: 'emailVerified',
      type: 'checkbox',
      defaultValue: false,
      access: { update: staffOnlyField },
      admin: { readOnly: serverOwned.readOnly },
    },
    {
      name: 'lastSeenAt',
      type: 'date',
      access: { update: staffOnlyField },
      admin: { readOnly: serverOwned.readOnly },
    },
  ],
}
