/**
 * Who the storefront visitor is signed in as.
 *
 * `customers` has been a real Payload auth collection since J1 — its own cookie, its own token,
 * `admin.user` pointing elsewhere so a customer cannot reach `/admin` at all. What J8 adds is the
 * *login flow*: the OTP, the forms, the account pages. The session mechanism itself already works,
 * which is why the support surfaces can be built now and simply show a signed-out state until then.
 *
 * One function, in one place, because "read the user off the request" is the check that must never
 * be got subtly wrong, and because a page and a route handler otherwise reach for it differently.
 *
 * **It returns the principal, not a boolean.** Every caller needs the id to scope by, and a helper
 * that answers "is someone signed in" invites the pattern where the id is then taken from
 * somewhere less trustworthy.
 */
import { getPayload, type Payload } from 'payload'

import config from '@payload-config'
import { customerIdOf } from '@/access'

/** What a signed-in storefront visitor looks like to the code that scopes on them. */
export interface CustomerSession {
  /** The raw principal, passed to ports that narrow it themselves. */
  user: unknown
  id: number | string
}

/**
 * Resolve the session from request headers.
 *
 * Takes `Headers` rather than a `Request` so a Server Component — which has headers but no request
 * object — can call it with `await headers()`.
 *
 * Never throws. A malformed or expired token is simply "not signed in": there is nothing a visitor
 * can do about a bad cookie except sign in again, and a 500 on every page would be the alternative.
 */
export async function readCustomerSession(
  requestHeaders: Headers,
  payloadInstance?: Payload,
): Promise<CustomerSession | null> {
  try {
    const payload = payloadInstance ?? (await getPayload({ config }))
    const { user } = await payload.auth({ headers: requestHeaders })

    const id = customerIdOf(user)

    // `customerIdOf` keys off the auth collection, so a *staff* session resolves to null here — a
    // signed-in admin browsing the storefront is not a customer and has no tickets of their own.
    return id === null ? null : { user, id }
  } catch {
    return null
  }
}
