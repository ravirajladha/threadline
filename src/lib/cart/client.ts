/**
 * The browser's one way to talk to `/api/cart`.
 *
 * This began life inside `CartView.tsx` with a note saying it should move here as soon as a third
 * caller appeared. `CheckoutView` was the second and the product page's add-to-bag is the third,
 * so here it is — a `lib/` module with no React in it, which is also what lets it be reasoned
 * about without rendering anything.
 *
 * It is the *transport*, not the logic. It knows the URL, the credentials mode and how to narrow
 * an untrusted response body; it makes no decisions about carts. Every figure it returns was
 * computed on the server.
 */
import type { CartView } from './types'

export type CartActionRequest =
  | { action: 'add'; variantId: number | string; qty: number }
  | { action: 'setQty'; variantId: number | string; qty: number }
  | { action: 'remove'; variantId: number | string }
  | { action: 'applyCoupon'; code: string }
  | { action: 'removeCoupon' }

export type CartActionResult = { ok: true; cart: CartView } | { ok: false; error: string }

export const CART_GENERIC_ERROR = 'Something went wrong updating your bag. Please try again.'

/**
 * Send one cart action and return the re-priced cart.
 *
 * `credentials: 'same-origin'` is load-bearing: the cart is identified by an httpOnly session
 * cookie, so a fetch that drops credentials does not fail — it silently creates a brand new
 * empty cart on every call, which presents as "adding to the bag does nothing".
 */
export async function postCartAction(request: CartActionRequest): Promise<CartActionResult> {
  let response: Response

  try {
    response = await fetch('/api/cart', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    // A network failure, not a rejected request. The customer gets one message either way.
    return { ok: false, error: CART_GENERIC_ERROR }
  }

  // The body is external input like any other, so it is narrowed rather than trusted.
  const body: unknown = await response.json().catch(() => null)

  if (response.ok && typeof body === 'object' && body !== null && 'cart' in body) {
    return { ok: true, cart: (body as { cart: CartView }).cart }
  }

  const error =
    typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error
      : CART_GENERIC_ERROR

  return { ok: false, error }
}
