/**
 * The cart contract.
 *
 * Same shape of decision as `catalog/types.ts`: these are plain serialisable views, and
 * `CartPort` is the interface the pages and endpoints depend on, with Payload behind it in
 * `payloadCart.ts`. A test builds an item list, not a database row.
 *
 * The stored cart is deliberately tiny — a variant id, a quantity, and the price the shopper
 * saw. Everything else on a cart line (title, image, size, colour, the current price, what is
 * left in stock) is looked up fresh on every read. A cart that cached its own titles would show
 * a product's old name for as long as the cart lived, and a cart that cached its own prices
 * would let a shopper hold yesterday's price by leaving a tab open.
 */
import type { ImageView } from '@/lib/catalog/types'
import type { CouponRejection } from '@/lib/pricing/coupon'
import type { CartPricing, PricingView } from '@/lib/pricing/totals'
import type { PaymentMethod } from '@/types'

/**
 * The most units of one variant a single cart line may hold.
 *
 * A technical guard rail, not a merchandising rule: it stops a typo or a scripted request from
 * asking for 10,000 of something and putting the reservation logic under pointless load. Real
 * scarcity is enforced by availability, which is always the lower cap in practice.
 */
export const MAX_LINE_QTY = 10

/** How long an untouched cart lives before the scheduler sweeps it and releases its stock. */
export const CART_TTL_DAYS = 30

/** What is actually stored on the `carts` document. */
export interface CartItem {
  variantId: number | string
  qty: number
  /** What the shopper saw when they added it. Never used as the price charged. */
  priceAtAddPaise: number
}

/**
 * Everything a cart line needs that lives on the variant and its product.
 *
 * Supplied by the port in one read, so building a cart view is pure and testable. `availableQty`
 * is already `stockQty − reservedQty` floored at zero.
 */
export interface CartVariantSnapshot {
  variantId: number | string
  sku: string
  productId: number | string
  productTitle: string
  productSlug: string
  categoryId: number | string | null
  categorySlug: string | null
  sizeLabel: string
  colourName: string
  colourHex: string
  image: ImageView | null
  /** The server's price: variant override, or the product MRP. Paise. */
  unitPricePaise: number
  taxRatePct: number
  availableQty: number
  /** False when the variant or its product has been deactivated since it was added. */
  isPurchasable: boolean
}

/** Why a line cannot be checked out as it stands. Null when the line is fine. */
export const CART_LINE_ISSUES = ['unavailable', 'insufficient_stock', 'price_changed'] as const
export type CartLineIssue = (typeof CART_LINE_ISSUES)[number]

/** One cart line, ready to render. */
export interface CartLineView {
  variantId: number | string
  sku: string
  productId: number | string
  productTitle: string
  productSlug: string
  categoryId: number | string | null
  sizeLabel: string
  colourName: string
  colourHex: string
  image: ImageView | null
  /** What the shopper asked for. */
  qty: number
  /**
   * What can actually be sold right now — `min(qty, availableQty)`, and zero for a line that
   * is no longer purchasable at all. The summary is priced on this, so the totals always equal
   * the sum of the line subtotals shown beside them, even mid-fix.
   */
  payableQty: number
  /** The price being charged — always the server's, never `priceAtAddPaise`. */
  unitPricePaise: number
  priceAtAddPaise: number
  /** unitPrice × payableQty. */
  lineSubtotalPaise: number
  taxRatePct: number
  availableQty: number
  /** The largest quantity the stepper may offer for this line. */
  maxQty: number
  issue: CartLineIssue | null
}

/**
 * A cart, priced and ready to render.
 *
 * `blockingIssues` is what stops the checkout button. A price change is shown but does **not**
 * block — the customer is told the price moved and charged the current one, which is honest and
 * still lets them buy.
 */
export interface CartView {
  id: number | string | null
  lines: CartLineView[]
  pricing: PricingView
  couponCode: string | null
  couponRejection: CouponRejection | null
  isEmpty: boolean
  blockingIssues: CartLineIssue[]
  canCheckout: boolean
}

/**
 * Everything checkout needs from the cart, read once.
 *
 * `couponId` travels separately from the view because the view carries the customer-facing
 * *code* while the order row stores the relationship — and looking the code back up at order
 * time would be a second query that could disagree with the first.
 */
export interface PricedCartResult {
  view: CartView
  pricing: CartPricing
  cartId: number | string | null
  /** The signed-in owner, or null for a guest cart. Never taken from the request body. */
  customerId: number | string | null
  couponId: number | string | null
}

/** What a caller asks the cart to do. Quantities are validated inside, never trusted. */
export interface CartMutation {
  variantId: number | string
  qty: number
}

/** Options that change the totals without changing the stored cart. */
export interface CartPricingOptions {
  shippingState?: string | null
  paymentMethod?: PaymentMethod
  loyaltyPointsRequested?: number
  now?: Date
}

/**
 * Everything the storefront asks of the cart.
 *
 * Note what is absent: nothing here takes a price, a total or a discount from the caller. The
 * server reads its own prices on every operation (OWASP A04).
 */
export interface CartPort {
  /** The cart for this session, creating one only if `create` is set. */
  getCart(sessionId: string, options?: CartPricingOptions & { create?: boolean }): Promise<CartView>
  /**
   * The same read, keeping the `CartPricing` and the owning customer that placing an order needs.
   *
   * Separate from `getCart` rather than folded into it because the extra payload is useless to a
   * page — it cannot be serialised to a client component — and every route that does not place an
   * order should not be handed the machinery for doing so.
   */
  getPricedCart(sessionId: string, options?: CartPricingOptions): Promise<PricedCartResult>
  addItem(sessionId: string, mutation: CartMutation, options?: CartPricingOptions): Promise<CartView>
  setItemQty(sessionId: string, mutation: CartMutation, options?: CartPricingOptions): Promise<CartView>
  removeItem(sessionId: string, variantId: number | string, options?: CartPricingOptions): Promise<CartView>
  applyCoupon(sessionId: string, code: string, options?: CartPricingOptions): Promise<CartView>
  removeCoupon(sessionId: string, options?: CartPricingOptions): Promise<CartView>
  /** Adopt a guest cart into the signed-in customer's, then discard the guest one. */
  mergeGuestCart(sessionId: string, customerId: number | string): Promise<CartView>
}
