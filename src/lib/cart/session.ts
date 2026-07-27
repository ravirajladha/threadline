/**
 * The cart session cookie.
 *
 * A guest cart's only handle. That makes this cookie a **bearer token for a cart**: anyone
 * holding the value can read and modify that cart, so it is httpOnly (script cannot read it),
 * SameSite=Lax (another site cannot drive a cart mutation with the browser's cookie attached),
 * and Secure outside development. It carries no customer identity and is never used for auth —
 * signing in issues a separate session, and `mergeGuestCart` connects the two once, server-side.
 *
 * The id is 256 bits of randomness from the platform CSPRNG. A guessable cart id would let
 * someone else's cart be read, which is why this is not a counter or a timestamp.
 */
import { randomBytes } from 'node:crypto'

export const CART_COOKIE = 'tl_cart'

/** 30 days, matching `CART_TTL_DAYS` — the cookie and the row expire together. */
export const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/** Opaque, unguessable, and not derived from anything about the shopper. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Whether a value could be one of ours.
 *
 * Cheap rejection of a hand-edited cookie before it becomes a database query. Not a security
 * boundary on its own — the lookup still has to miss — but it keeps junk out of the query log
 * and bounds the length of anything that reaches the adapter.
 */
export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value)
}

export interface CartCookieOptions {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
}

export function cartCookieOptions(isProduction = process.env.NODE_ENV === 'production'): CartCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Off in development only, where localhost is plain HTTP and a Secure cookie would
    // simply never be set — which looks exactly like a broken cart.
    secure: isProduction,
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  }
}

/** When a cart written now should be swept. */
export function cartExpiry(from: Date, ttlDays: number): Date {
  return new Date(from.getTime() + ttlDays * 24 * 60 * 60 * 1000)
}
