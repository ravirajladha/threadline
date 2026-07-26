/**
 * Payload access functions.
 *
 * Every collection declares `access` built from this module — no collection writes its own
 * inline rule, and none is left to Payload's defaults. The rules here are thin: they resolve
 * the actor (`./actor`), consult the matrix (`./permissions`), and return either a boolean or
 * a `Where` constraint that Payload folds into the SQL query.
 *
 * Returning a `Where` rather than filtering afterwards is what makes customer scoping safe
 * under OWASP A01: the database never returns another customer's row in the first place, so
 * there is nothing for a forgotten filter downstream to leak.
 */
import type { Access, Where } from 'payload'

import { customerIdOf, isSuperAdmin, staffIdOf, staffRoleOf } from './actor'
import { canRead, canWrite } from './permissions'
import type { Resource } from '@/types'

export * from './actor'
export * from './permissions'

// --- Primitives -------------------------------------------------------------

/** Nobody, ever, through the API. Server-side writes use `overrideAccess`. */
export const denyAll: Access = () => false

/** Genuinely public data — the catalog the storefront renders for anonymous visitors. */
export const allowAll: Access = () => true

export const superAdminOnly: Access = ({ req }) => isSuperAdmin(req.user)

/** Any signed-in staff member, regardless of role. Gate for admin-panel entry only. */
export const anyStaff: Access = ({ req }) => staffRoleOf(req.user) !== null

// --- Staff, by resource -----------------------------------------------------

/** Staff whose role grants read (or better) on `resource`. */
export function staffRead(resource: Resource): Access {
  return ({ req }) => canRead(staffRoleOf(req.user), resource)
}

/** Staff whose role grants full control of `resource`. */
export function staffWrite(resource: Resource): Access {
  return ({ req }) => canWrite(staffRoleOf(req.user), resource)
}

// --- Catalog ----------------------------------------------------------------

/**
 * Public catalog data: anyone may read, only `catalog` writers may change it.
 * Draft and archived products are filtered by the storefront query, not by access —
 * staff must still be able to preview them.
 */
export const publicReadStaffWrite = {
  read: allowAll,
  create: staffWrite('catalog'),
  update: staffWrite('catalog'),
  delete: staffWrite('catalog'),
} as const

// --- Customer-scoped --------------------------------------------------------

interface OwnScopedOptions {
  /** Which staff resource governs staff access to this collection. */
  resource: Resource
  /**
   * Path from the document to the owning customer. Direct (`'customer'`) or across a
   * relationship (`'order.customer'`) — Payload turns both into a join in one query.
   */
  ownerField: string
}

function ownerConstraint(ownerField: string, customerId: string | number): Where {
  return { [ownerField]: { equals: customerId } }
}

/**
 * Read access for data a customer owns: their orders, addresses, tickets, returns.
 *
 * Staff see everything their role allows. A signed-in customer sees only rows matching
 * `ownerField`. Everyone else sees nothing.
 */
export function ownScopedRead({ resource, ownerField }: OwnScopedOptions): Access {
  return ({ req }) => {
    if (canRead(staffRoleOf(req.user), resource)) return true

    const customerId = customerIdOf(req.user)
    if (customerId === null) return false

    return ownerConstraint(ownerField, customerId)
  }
}

/**
 * Update/delete access for data a customer owns.
 *
 * Note the asymmetry with `ownScopedRead`: staff need **write** on the resource, not read.
 * A `support_agent` may read every order and change none.
 */
export function ownScopedWrite({ resource, ownerField }: OwnScopedOptions): Access {
  return ({ req }) => {
    if (canWrite(staffRoleOf(req.user), resource)) return true

    const customerId = customerIdOf(req.user)
    if (customerId === null) return false

    return ownerConstraint(ownerField, customerId)
  }
}

/**
 * Create access for rows a customer makes for themselves — an address, a ticket, a review.
 * The owning customer is stamped by a `beforeChange` hook, never taken from the payload,
 * so a customer cannot create a row belonging to somebody else (OWASP A01).
 */
export function customerOrStaffCreate(resource: Resource): Access {
  return ({ req }) => canWrite(staffRoleOf(req.user), resource) || customerIdOf(req.user) !== null
}

// --- Auth collections -------------------------------------------------------

/**
 * A staff member may always read and update their own row; otherwise the `users` resource
 * decides. Without the self-clause a non-super_admin could not change their own password.
 */
export const staffSelfOrUsersResource: Access = ({ req }) => {
  const role = staffRoleOf(req.user)
  if (canRead(role, 'users')) return true

  const selfId = staffIdOf(req.user)
  if (selfId === null) return false

  return { id: { equals: selfId } }
}

export const staffSelfOrUsersWrite: Access = ({ req }) => {
  const role = staffRoleOf(req.user)
  if (canWrite(role, 'users')) return true

  const selfId = staffIdOf(req.user)
  if (selfId === null) return false

  return { id: { equals: selfId } }
}

/** A customer may read and update only their own account row. */
export const customerSelfOrStaff: Access = ({ req }) => {
  if (canRead(staffRoleOf(req.user), 'customers')) return true

  const customerId = customerIdOf(req.user)
  if (customerId === null) return false

  return { id: { equals: customerId } }
}

export const customerSelfOrStaffWrite: Access = ({ req }) => {
  if (canWrite(staffRoleOf(req.user), 'customers')) return true

  const customerId = customerIdOf(req.user)
  if (customerId === null) return false

  return { id: { equals: customerId } }
}

// --- Reviews ----------------------------------------------------------------

/**
 * Approved reviews are public. A customer additionally sees their own while it is still
 * pending, so submitting a review does not look like it vanished.
 */
export const reviewRead: Access = ({ req }) => {
  if (canRead(staffRoleOf(req.user), 'support')) return true

  const approved: Where = { status: { equals: 'approved' } }
  const customerId = customerIdOf(req.user)
  if (customerId === null) return approved

  return { or: [approved, { customer: { equals: customerId } }] }
}
