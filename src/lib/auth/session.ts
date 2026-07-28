/**
 * Issuing and clearing a customer session.
 *
 * A one-time code has no password, and `payload.login()` wants one — so this mints the session
 * token directly. The important decision is **whose primitives**: `jwtSign`, `getFieldsToSign` and
 * `generatePayloadCookie` are Payload's own, so the claims, the signing secret, the cookie name and
 * its flags all come from the same config `payload.auth()` validates against. Hand-rolling a JWT
 * here would work on the day it was written and drift the first time Payload changed a claim or a
 * cookie default — and the failure mode of that drift is either "nobody can log in" or, far worse,
 * a token this app accepts that Payload's own middleware does not agree about.
 *
 * The cookie is `httpOnly`, `SameSite=Lax` and `secure` in production, all from the `customers`
 * collection's `auth.cookies` block set in J1 — this module chooses none of that (OWASP A02). It is
 * `Lax` rather than `Strict` for the same reason the order cookie is: `Strict` is withheld on
 * cross-site returns, and a customer arriving back from a payment page would find themselves
 * silently signed out.
 *
 * Nothing readable by the browser is set. There is no "logged in" flag in `localStorage` and no
 * mirror of the token in a non-httpOnly cookie: the server decides who you are on every request.
 */
import type { Payload } from 'payload'
import { getFieldsToSign, jwtSign } from 'payload'
import { generateExpiredPayloadCookie, generatePayloadCookie } from 'payload/shared'

import { CUSTOMER_COLLECTION } from '@/access'
import type { Customer } from '@/payload-types'

/** Payload's default cookie prefix. The customers collection does not override it. */
const COOKIE_PREFIX = 'payload'

function customersAuthConfig(payload: Payload) {
  const collection = payload.collections[CUSTOMER_COLLECTION]

  if (collection === undefined) {
    throw new Error(`The "${CUSTOMER_COLLECTION}" collection is not registered — cannot issue a session`)
  }

  return collection.config
}

/**
 * A `Set-Cookie` header value that signs `customer` in.
 *
 * Returned rather than applied, so the caller attaches it to whichever response it is already
 * building — and so this module never reaches for a request context it was not given.
 */
export async function issueCustomerSessionCookie(
  payload: Payload,
  customer: Customer,
): Promise<string> {
  const config = customersAuthConfig(payload)

  const fieldsToSign = getFieldsToSign({
    collectionConfig: config,
    email: customer.email,
    // The claims Payload itself would sign — id, collection, email, and whatever `saveToJWT`
    // fields the collection declares. Assembling this by hand is how a custom auth route ends up
    // issuing a token that is missing the one claim an access rule reads.
    user: { ...customer, collection: CUSTOMER_COLLECTION } as Parameters<typeof getFieldsToSign>[0]['user'],
  })

  const { token } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration: config.auth.tokenExpiration,
  })

  return generatePayloadCookie({
    collectionAuthConfig: config.auth,
    cookiePrefix: COOKIE_PREFIX,
    token,
  })
}

/**
 * A `Set-Cookie` header value that signs the visitor out.
 *
 * An expired cookie with the *same* name, path and flags — anything else leaves the original in
 * place and "sign out" silently does nothing, which is the classic version of this bug.
 */
export function expireCustomerSessionCookie(payload: Payload): string {
  return generateExpiredPayloadCookie({
    collectionAuthConfig: customersAuthConfig(payload).auth,
    cookiePrefix: COOKIE_PREFIX,
  })
}
