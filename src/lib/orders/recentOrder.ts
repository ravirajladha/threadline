/**
 * Remembering the order a guest has just placed, so the confirmation page can show it.
 *
 * The problem this solves is small and easy to get wrong. `/checkout/success?order=TL-20260727-0004`
 * reads naturally, but an order number is a date and a sequence — trivially guessable — so a page
 * that trusted that parameter would hand any visitor a stranger's name, address and phone number
 * by counting upwards (OWASP A01).
 *
 * Until J8 brings real accounts there is no session to check it against, so the order number is
 * carried in an httpOnly cookie written by the checkout route at the moment the order is created.
 * The page reads **only** the cookie; the query parameter is never consulted, which is why the
 * obvious attack is not merely blocked but unexpressible.
 *
 * Short-lived on purpose: this is a hand-off between two requests, not a session. It survives the
 * payment round trip and a refresh or two, and then it is gone. Once J8 lands, an order is read
 * through the customer relationship and this becomes the guest-only path.
 */
import { cookies } from 'next/headers'

import { isOrderNumber } from './orderNumber'

export const ORDER_COOKIE = 'tl_order'

/** Long enough to pay and come back, short enough that a shared machine does not leak it. */
export const ORDER_COOKIE_MAX_AGE_SECONDS = 60 * 60

/**
 * Whether a cookie value could be one of our order numbers.
 *
 * Validated coming *out* of the cookie as well as going in: a cookie is client-side storage and
 * therefore an input like any other, and this is what stops a hand-edited value reaching a
 * database query. The shape is `orderNumber.ts`'s to define, so this defers to it rather than
 * carrying a second regex that would drift the day the format changes.
 */
function isStoredOrderNumber(value: unknown): value is string {
  return typeof value === 'string' && isOrderNumber(value)
}

export function orderCookieOptions(isProduction = process.env.NODE_ENV === 'production'): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
} {
  return {
    httpOnly: true,
    // Lax, not Strict: the customer returns from a payment gateway by a cross-site redirect, and
    // a Strict cookie is withheld on exactly that navigation — the confirmation page would come
    // up blank for everyone who actually paid.
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: ORDER_COOKIE_MAX_AGE_SECONDS,
  }
}

/** Route handlers and Server Actions only — a Server Component cannot set a cookie. */
export async function rememberOrder(orderNumber: string): Promise<void> {
  const store = await cookies()
  store.set(ORDER_COOKIE, orderNumber, orderCookieOptions())
}

/** The order this visitor just placed, or null. Safe to call during render. */
export async function readRecentOrder(): Promise<string | null> {
  const store = await cookies()
  const value = store.get(ORDER_COOKIE)?.value

  return isStoredOrderNumber(value) ? value : null
}
