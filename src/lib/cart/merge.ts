/**
 * Merging a guest cart into a customer's cart at login.
 *
 * The scenario is ordinary and the wrong answer is memorable: a shopper fills a cart while
 * signed out, signs in to check out, and watches the cart empty itself. That happens when login
 * simply switches to the customer's stored cart.
 *
 * So the two are unioned. Quantities of the same variant **sum**, then clamp — a shopper with
 * two of a shirt in each cart wanted more than one, and the honest reading of that is four, not
 * two. Clamping afterwards is what keeps it from exceeding stock.
 *
 * `priceAtAddPaise` is taken from the **guest** line when both carts hold a variant, because the
 * guest cart is the one the shopper was just looking at. It only ever affects whether the cart
 * says "the price changed", never what is charged.
 */
import { MAX_LINE_QTY, type CartItem } from './types'

function key(variantId: number | string): string {
  return String(variantId)
}

/**
 * Union two item lists.
 *
 * Order is the customer's stored lines first, then guest lines they did not already hold —
 * which reads as "your cart, plus what you just added" rather than reshuffling on login.
 */
export function mergeItems(
  customerItems: readonly CartItem[],
  guestItems: readonly CartItem[],
  availabilityOf: (variantId: number | string) => number,
): CartItem[] {
  const merged = new Map<string, CartItem>()

  for (const item of customerItems) {
    merged.set(key(item.variantId), { ...item })
  }

  for (const item of guestItems) {
    const existing = merged.get(key(item.variantId))

    if (existing === undefined) {
      merged.set(key(item.variantId), { ...item })
      continue
    }

    merged.set(key(item.variantId), {
      ...existing,
      qty: existing.qty + item.qty,
      // The guest line is the more recent view of the price.
      priceAtAddPaise: item.priceAtAddPaise,
    })
  }

  const result: CartItem[] = []

  for (const item of merged.values()) {
    const available = Math.max(0, Math.floor(availabilityOf(item.variantId)))
    if (available === 0) continue

    result.push({ ...item, qty: Math.min(item.qty, available, MAX_LINE_QTY) })
  }

  return result
}

/**
 * Which coupon survives a merge.
 *
 * The guest's code wins when there is one, because it is the code they just typed. Re-validated
 * against the merged cart afterwards regardless — a code that needed a ₹2,000 cart is not
 * carried over on the strength of having once been valid.
 */
export function mergeCoupon(
  customerCoupon: number | string | null,
  guestCoupon: number | string | null,
): number | string | null {
  return guestCoupon ?? customerCoupon
}
