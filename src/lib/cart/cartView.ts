/**
 * Building the cart a customer sees.
 *
 * The one rule this module exists to enforce: **the server re-prices every line on every read**
 * (OWASP A04). `priceAtAddPaise` is kept only so the cart can say "this price changed since you
 * added it" — it is never the figure charged. A cart that trusted its own stored price would let
 * anyone hold yesterday's price by leaving a tab open, or set any price at all by editing a
 * request body.
 *
 * Reading a cart does **not** write to it. A variant can sell out or be deactivated between two
 * visits, and the tempting fix is to quietly trim the cart on read — but a read that writes is a
 * surprise, it races with itself across two tabs, and it silently deletes something the shopper
 * chose. So a stale line is *flagged*, priced at what can actually be sold, and the customer is
 * told. `blockingIssues` is what holds the checkout button.
 *
 * A price change is shown but never blocks. The customer is told it moved and charged the
 * current price, which is honest and still lets them buy.
 */
import { evaluateCoupon, type CouponRule } from '@/lib/pricing/coupon'
import { priceCart, toPricingView, type PriceableLine, type PricingSettings } from '@/lib/pricing/totals'
import { Money } from '@/lib/pricing/money'
import type {
  CartItem,
  CartLineIssue,
  CartLineView,
  CartPricingOptions,
  CartVariantSnapshot,
  CartView,
} from './types'

export interface BuildCartInput {
  id: number | string | null
  items: readonly CartItem[]
  /** One per item that still resolves. A missing entry means the variant is gone. */
  snapshots: readonly CartVariantSnapshot[]
  settings: PricingSettings
  /** The applied coupon, already loaded. Null when none is applied or the code is unknown. */
  coupon: CouponRule | null
  couponUsageByCustomer?: number
  loyaltyBalance?: number
  options?: CartPricingOptions
}

/**
 * The line's problem, if it has one.
 *
 * Ordered by severity: being unbuyable outranks being short of stock, which outranks a price
 * that moved. Only one is reported, because a line with three warnings on it is a line nobody
 * reads.
 */
function lineIssue(
  snapshot: CartVariantSnapshot | undefined,
  item: CartItem,
): CartLineIssue | null {
  if (snapshot === undefined || !snapshot.isPurchasable || snapshot.availableQty <= 0) {
    return 'unavailable'
  }
  if (item.qty > snapshot.availableQty) return 'insufficient_stock'
  if (item.priceAtAddPaise !== snapshot.unitPricePaise) return 'price_changed'

  return null
}

/** A line whose variant no longer resolves at all. Still shown, so removing it is a choice. */
function orphanLine(item: CartItem): CartLineView {
  return {
    variantId: item.variantId,
    sku: '',
    productId: '',
    productTitle: 'This item is no longer available',
    productSlug: '',
    categoryId: null,
    sizeLabel: '',
    colourName: '',
    colourHex: '#000000',
    image: null,
    qty: item.qty,
    payableQty: 0,
    unitPricePaise: item.priceAtAddPaise,
    priceAtAddPaise: item.priceAtAddPaise,
    lineSubtotalPaise: 0,
    taxRatePct: 0,
    availableQty: 0,
    maxQty: 0,
    issue: 'unavailable',
  }
}

/**
 * Assemble the cart view and its totals.
 *
 * Pure. Given the same items, snapshots and settings it produces the same cart, which is what
 * lets the awkward cases — a sold-out line, a price that moved, a coupon that no longer
 * qualifies — be tests rather than a staged database.
 */
export function buildCartView(input: BuildCartInput): CartView {
  const { id, items, snapshots, settings, coupon, couponUsageByCustomer = 0, loyaltyBalance = 0, options = {} } = input

  const byVariant = new Map(snapshots.map((snapshot) => [String(snapshot.variantId), snapshot]))

  const lines: CartLineView[] = []
  const priceable: PriceableLine[] = []

  for (const item of items) {
    const snapshot = byVariant.get(String(item.variantId))

    if (snapshot === undefined) {
      lines.push(orphanLine(item))
      continue
    }

    const issue = lineIssue(snapshot, item)
    // A deactivated variant is unsellable at any stock level, so availability alone is not
    // enough to decide what may be charged for.
    const payableQty = snapshot.isPurchasable ? Math.max(0, Math.min(item.qty, snapshot.availableQty)) : 0
    const unitPrice = Money.fromPaise(snapshot.unitPricePaise)

    lines.push({
      variantId: snapshot.variantId,
      sku: snapshot.sku,
      productId: snapshot.productId,
      productTitle: snapshot.productTitle,
      productSlug: snapshot.productSlug,
      categoryId: snapshot.categoryId,
      sizeLabel: snapshot.sizeLabel,
      colourName: snapshot.colourName,
      colourHex: snapshot.colourHex,
      image: snapshot.image,
      qty: item.qty,
      payableQty,
      unitPricePaise: snapshot.unitPricePaise,
      priceAtAddPaise: item.priceAtAddPaise,
      lineSubtotalPaise: unitPrice.multiply(payableQty).toPaise(),
      taxRatePct: snapshot.taxRatePct,
      availableQty: snapshot.availableQty,
      maxQty: snapshot.availableQty,
      issue,
    })

    if (payableQty > 0 && snapshot.isPurchasable) {
      priceable.push({
        variantId: snapshot.variantId,
        productId: snapshot.productId,
        categoryId: snapshot.categoryId,
        qty: payableQty,
        unitPrice,
        taxRatePct: snapshot.taxRatePct,
      })
    }
  }

  const pricing = priceCart({
    lines: priceable,
    settings,
    coupon,
    couponUsageByCustomer,
    loyaltyBalance,
    loyaltyPointsRequested: options.loyaltyPointsRequested ?? 0,
    shippingState: options.shippingState ?? null,
    paymentMethod: options.paymentMethod ?? 'razorpay',
    ...(options.now ? { now: options.now } : {}),
  })

  // A price change is a notice, not a blocker.
  const blockingIssues = [...new Set(lines.map((line) => line.issue))].filter(
    (issue): issue is CartLineIssue => issue === 'unavailable' || issue === 'insufficient_stock',
  )

  return {
    id,
    lines,
    pricing: toPricingView(pricing),
    couponCode: pricing.coupon?.code ?? null,
    couponRejection: pricing.couponRejection,
    isEmpty: lines.length === 0,
    blockingIssues,
    canCheckout: lines.length > 0 && blockingIssues.length === 0 && priceable.length > 0,
  }
}

/**
 * Whether an applied coupon still qualifies against a cart.
 *
 * Called after a merge and again at checkout. A code that was valid when it was typed can stop
 * qualifying when the cart shrinks below its minimum, and honouring it anyway is the difference
 * between a discount and a leak.
 */
export function couponStillValid(input: {
  coupon: CouponRule | null
  lines: readonly CartLineView[]
  couponUsageByCustomer?: number
  now?: Date
}): boolean {
  if (input.coupon === null) return false

  const evaluation = evaluateCoupon({
    coupon: input.coupon,
    lines: input.lines.map((line) => ({
      productId: line.productId,
      categoryId: line.categoryId,
      amount: Money.fromPaise(line.lineSubtotalPaise),
    })),
    now: input.now ?? new Date(),
    customerUsageCount: input.couponUsageByCustomer ?? 0,
  })

  return evaluation.ok
}
