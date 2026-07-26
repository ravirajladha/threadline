import type { CollectionConfig, FieldAccess } from 'payload'

import { isSuperAdmin, staffSelfOrUsersResource, staffSelfOrUsersWrite, staffWrite } from '@/access'
import { isActiveField } from './fields'
import { STAFF_ROLES } from '@/types'

/**
 * Only a super_admin may set or change a role.
 *
 * Without this, any staff member who can edit their own row — which they must, to change
 * their password — could promote themselves to super_admin. Field-level access is the fix:
 * the row is writable, the role field is not (OWASP A01, privilege escalation).
 */
const superAdminField: FieldAccess = ({ req }) => isSuperAdmin(req.user)

/**
 * Staff accounts. Customers authenticate against `customers` instead — two auth collections
 * so that a storefront account can never carry a staff role, whatever a request claims.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    read: staffSelfOrUsersResource,
    create: staffWrite('users'),
    update: staffSelfOrUsersWrite,
    delete: staffWrite('users'),
    admin: ({ req }) => req.user?.collection === 'users',
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role', 'isActive'],
    group: 'People',
  },
  auth: {
    // OWASP A07 — short-lived sessions, throttled logins, no unbounded guessing.
    tokenExpiration: 60 * 60 * 8,
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    cookies: {
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'support_agent',
      index: true,
      options: STAFF_ROLES.map((value) => ({ label: value, value })),
      access: {
        // Create is already super_admin-only at the collection level; leaving the field open
        // on create is what lets Payload's "first user" screen set up the first super_admin.
        update: superAdminField,
      },
      admin: {
        description: 'What this account may do. Only a super_admin can change it.',
      },
    },
    isActiveField(),
  ],
  versions: false,
}
