/**
 * Who is making the request.
 *
 * Two auth collections share one `req.user`: `users` (staff, with a role) and `customers`
 * (storefront accounts, with no role at all). Every access rule starts by asking this module
 * which of the two — if either — is present, so no rule has to re-derive it and none can get
 * the check subtly wrong.
 *
 * Deliberately framework-free and defensive: it takes `unknown` and narrows, because the
 * shape of `req.user` is only as trustworthy as the session that produced it.
 */
import { isStaffRole } from './permissions'
import type { StaffRole } from '@/types'

/** The staff auth collection slug. */
export const STAFF_COLLECTION = 'users'
/** The storefront auth collection slug. */
export const CUSTOMER_COLLECTION = 'customers'

/** Anything Payload might hand us as an authenticated principal. */
interface ActorShape {
  id?: unknown
  collection?: unknown
  role?: unknown
  isActive?: unknown
}

function asActor(user: unknown): ActorShape | null {
  return typeof user === 'object' && user !== null ? (user as ActorShape) : null
}

function actorId(actor: ActorShape): string | number | null {
  const { id } = actor
  if (typeof id === 'string' && id.length > 0) return id
  if (typeof id === 'number') return id
  return null
}

/**
 * The staff role of `user`, or `null` if they are not active staff.
 *
 * A deactivated account keeps its row (orders reference it) but loses every permission —
 * `isActive: false` is a hard deny, checked here rather than in five separate places.
 */
export function staffRoleOf(user: unknown): StaffRole | null {
  const actor = asActor(user)
  if (!actor || actor.collection !== STAFF_COLLECTION) return null
  if (actor.isActive === false) return null
  return isStaffRole(actor.role) ? actor.role : null
}

/** The id of the signed-in customer, or `null` if the request is staff or anonymous. */
export function customerIdOf(user: unknown): string | number | null {
  const actor = asActor(user)
  if (!actor || actor.collection !== CUSTOMER_COLLECTION) return null
  return actorId(actor)
}

/** The id of the signed-in staff member, or `null`. Used for "may edit self" rules. */
export function staffIdOf(user: unknown): string | number | null {
  const actor = asActor(user)
  if (!actor || actor.collection !== STAFF_COLLECTION) return null
  if (actor.isActive === false) return null
  return actorId(actor)
}

export function isStaff(user: unknown): boolean {
  return staffRoleOf(user) !== null
}

export function isCustomer(user: unknown): boolean {
  return customerIdOf(user) !== null
}

export function isSuperAdmin(user: unknown): boolean {
  return staffRoleOf(user) === 'super_admin'
}
