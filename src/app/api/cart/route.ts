/**
 * `/api/cart` — every cart mutation the storefront makes.
 *
 * One endpoint with an `action` discriminator rather than five routes, because they share the
 * whole of their contract: identify the session, apply one change, return the **re-priced cart**
 * so the browser never has to compute a total. `CartView.tsx` is its only caller and replaces its
 * state wholesale with whatever comes back.
 *
 * The security shape of this route:
 *
 * - **The session cookie is the authority.** No id in the body says which cart to touch, so
 *   there is nothing to tamper with — asking for someone else's cart is not expressible in the
 *   request (OWASP A01).
 * - **No price, total or discount is accepted from the caller.** The body carries a variant id, a
 *   quantity and a coupon code; every figure in the response was read server-side (OWASP A04).
 * - Rate-limited, with coupon application on a tighter allowance than the rest: an unlimited
 *   apply is an oracle for guessing valid codes.
 */
import { MAX_LINE_QTY, type CartView } from '@/lib/cart/types'
import { ensureCartSession, getCart, readCartSession } from '@/lib/cart/server'
import { enforceRateLimit, json, readJsonBody, safeRoute, toId, toQty } from '@/lib/http/route'

/** The cart is per-session and re-priced on every read; caching it would be actively wrong. */
export const dynamic = 'force-dynamic'

const BAD_REQUEST = 'We could not understand that request.'

/** The longest thing that could plausibly be a coupon code, before it becomes a query. */
const MAX_COUPON_LENGTH = 64

export const GET = safeRoute(async (): Promise<Response> => {
  const sessionId = await readCartSession()
  const cart = await getCart()

  // No cookie means no cart. Reading must not mint a session — a crawler walking the site would
  // otherwise leave a `carts` row per page view.
  if (sessionId === null) {
    return json({ cart: await cart.getCart('', { create: false }) })
  }

  return json({ cart: await cart.getCart(sessionId) })
})

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  const body = await readJsonBody(request)
  if (body === null) return json({ error: BAD_REQUEST }, 400)

  const action = typeof body.action === 'string' ? body.action : null
  if (action === null) return json({ error: BAD_REQUEST }, 400)

  const limited = enforceRateLimit(request, action === 'applyCoupon' ? 'couponApply' : 'cartMutation')
  if (limited !== null) return limited

  const cart = await getCart()

  // A mutation is allowed to create the cart it is about to change — that is what "add to bag"
  // means for a first-time visitor. This is a route handler, so setting the cookie is legal here.
  const sessionId = await ensureCartSession()

  switch (action) {
    case 'add':
    case 'setQty': {
      const variantId = toId(body.variantId)
      // `add` without a quantity means one; `setQty` without one is meaningless and refused,
      // rather than being read as "set it to zero" and deleting the customer's line.
      const qty = toQty(body.qty, MAX_LINE_QTY) ?? (action === 'add' ? 1 : null)

      if (variantId === null || qty === null) return json({ error: BAD_REQUEST }, 400)

      const updated: CartView =
        action === 'add'
          ? await cart.addItem(sessionId, { variantId, qty })
          : await cart.setItemQty(sessionId, { variantId, qty })

      return json({ cart: updated })
    }

    case 'remove': {
      const variantId = toId(body.variantId)
      if (variantId === null) return json({ error: BAD_REQUEST }, 400)

      return json({ cart: await cart.removeItem(sessionId, variantId) })
    }

    case 'applyCoupon': {
      const code = typeof body.code === 'string' ? body.code.trim() : ''

      if (code.length === 0 || code.length > MAX_COUPON_LENGTH) {
        return json({ error: 'Please enter a coupon code.' }, 400)
      }

      // An unknown or unqualifying code is not an error here. The port stores it as "no coupon"
      // and the pricing layer returns a typed rejection, which the cart renders as a reason the
      // customer can act on — a 400 would replace that with a dead end.
      return json({ cart: await cart.applyCoupon(sessionId, code) })
    }

    case 'removeCoupon':
      return json({ cart: await cart.removeCoupon(sessionId) })

    default:
      return json({ error: BAD_REQUEST }, 400)
  }
})
