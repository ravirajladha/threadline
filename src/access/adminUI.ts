/**
 * Admin navigation, filtered by role.
 *
 * A `support_agent` who can do nothing with Coupons should not be looking at a Coupons link.
 * That is a usability concern, not a security one — and the distinction matters. **Hiding is
 * never the control.** `src/access/` already refuses the request; this only stops the admin
 * offering a door that is locked. If these two ever disagree, the access rule is right.
 *
 * Kept beside the access rules rather than in each collection so both read from the same
 * matrix and cannot drift apart.
 */
import { canRead } from './permissions'
import { staffRoleOf } from './actor'
import type { Resource } from '@/types'

/** Payload passes the client-side user, which carries the same `collection` and `role`. */
type HiddenArgs = { user: unknown }

/**
 * Hide a collection from the nav unless the signed-in role can read `resource`.
 *
 * Note the direction — this returns `hidden`, so it is the negation of `canRead`. Anonymous or
 * unrecognised means hidden, which is the safe default for a nav that is rendered before the
 * session is fully resolved.
 */
export function hiddenUnlessCanRead(resource: Resource): (args: HiddenArgs) => boolean {
  return ({ user }) => !canRead(staffRoleOf(user), resource)
}
