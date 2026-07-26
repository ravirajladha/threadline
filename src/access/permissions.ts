/**
 * The staff permission matrix, as data.
 *
 * Every collection maps onto one `Resource` and asks this module what a role may do with it.
 * Keeping the matrix in one table means a role change is a single edit that is impossible to
 * apply inconsistently, and means the whole policy can be unit tested without a database,
 * a request or a running Payload instance.
 *
 * Mirrors the role matrix in `docs/SCHEMA.md`. The two must be changed together.
 */
import { RESOURCES, STAFF_ROLES, type PermissionLevel, type Resource, type StaffRole } from '@/types'

const ROLE_MATRIX: Readonly<Record<StaffRole, Readonly<Record<Resource, PermissionLevel>>>> = {
  super_admin: {
    catalog: 'full',
    orders: 'full',
    refunds: 'full',
    support: 'full',
    coupons: 'full',
    customers: 'full',
    users: 'full',
    settings: 'full',
  },
  catalog_manager: {
    catalog: 'full',
    orders: 'read',
    refunds: 'none',
    support: 'none',
    coupons: 'none',
    customers: 'none',
    users: 'none',
    settings: 'none',
  },
  order_manager: {
    catalog: 'read',
    orders: 'full',
    refunds: 'full',
    support: 'read',
    coupons: 'none',
    customers: 'read',
    users: 'none',
    settings: 'none',
  },
  support_agent: {
    catalog: 'read',
    orders: 'read',
    refunds: 'none',
    support: 'full',
    coupons: 'none',
    customers: 'read',
    users: 'none',
    settings: 'none',
  },
  marketing: {
    catalog: 'read',
    orders: 'read',
    refunds: 'none',
    support: 'none',
    coupons: 'full',
    customers: 'none',
    users: 'none',
    settings: 'none',
  },
}

/** The matrix, exposed read-only so an admin screen can render it without duplicating it. */
export const roleMatrix = ROLE_MATRIX

/**
 * Narrowing guard — anything that is not a known role is not staff.
 *
 * Checks the role list rather than `value in ROLE_MATRIX`: `in` walks the prototype chain, so
 * a stored role of `"toString"` or `"constructor"` would otherwise pass as a real role.
 */
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)
}

export function isResource(value: unknown): value is Resource {
  return typeof value === 'string' && (RESOURCES as readonly string[]).includes(value)
}

/**
 * What `role` may do with `resource`. Deny by default: an unrecognised role gets `none`
 * rather than throwing, so a stale token can never fail open.
 */
export function permissionFor(role: StaffRole | null | undefined, resource: Resource): PermissionLevel {
  if (!isStaffRole(role)) return 'none'
  return ROLE_MATRIX[role][resource]
}

/** `full` implies `read` — no role can write something it cannot see. */
export function canRead(role: StaffRole | null | undefined, resource: Resource): boolean {
  const level = permissionFor(role, resource)
  return level === 'read' || level === 'full'
}

export function canWrite(role: StaffRole | null | undefined, resource: Resource): boolean {
  return permissionFor(role, resource) === 'full'
}

/** Every resource a role can see. Drives which collections appear in the admin nav. */
export function readableResources(role: StaffRole | null | undefined): Resource[] {
  return RESOURCES.filter((resource) => canRead(role, resource))
}
