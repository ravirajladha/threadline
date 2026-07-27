/**
 * The one place a cart total is computed.
 *
 * `priceCart` is the composer: it walks the lines, adds GST, asks `coupon.ts` and `loyalty.ts`
 * what they are worth, asks `shipping.ts` for carriage, and then **checks its own arithmetic**.
 * If subtotal + shipping + tax − discount − loyalty does not equal the grand total to the
 * paise, it throws. A wrong order is worse than a failed checkout: the customer is charged an
 * amount that cannot be reconciled against its own line items, and somebody finds out at
 * refund time.
 *
 * Two ordering decisions, both deliberate:
 *
 * **Tax is computed on the undiscounted line amount**, per `docs/SCHEMA.md`, and the discount
 * comes off afterwards. Allocating a coupon across lines before taxing them is arguably more
 * correct for a GST return, and it is a bigger change than it looks — it needs a documented
 * allocation rule with a remainder policy. Left as the owner's call (CLAUDE.md §7).
 *
 * **Points apply to the subtotal after the coupon**, so a customer cannot use both to discount
 * the same rupee twice.
 *
 * Everything in and out is `Money`. `toPricingView` is the only place paise become plain
 * numbers, at the boundary where the result crosses into a component.
 */
import { Money } from './money'
import { evaluateCoupon, type CouponEvaluation, type CouponLine, type CouponRejection, type CouponRule } from './coupon'
import { redeemPoints, pointsEarned, maxRedeemablePoints, type LoyaltyRejection, type LoyaltyRules } from './loyalty'
import { shippingFor, type ShippingRules } from './shipping'
import { addBreakups, breakupTotal, emptyBreakup, splitTax, taxJurisdiction, taxOn, type TaxBreakup } from './tax'
import type { PaymentMethod, TaxJurisdiction } from '@/types'

/** A line as it arrives from the cart: identity, quantity, and the server's own price. */
export interface PriceableLine {
  variantId: number | string
  productId: number | string
  categoryId: number | string | null
  qty: number
  /** The server's price for the variant. Never the figure the client sent (OWASP A04). */
  unitPrice: Money
  taxRatePct: number
}

/** A line after pricing. `lineTotal` includes its tax. */
export interface PricedLine {
  variantId: number | string
  qty: number
  unitPrice: Money
  /** unitPrice × qty, before tax. */
  lineSubtotal: Money
  taxRatePct: number
  tax: Money
  lineTotal: Money
}

/** Everything `priceCart` needs from the `settings` global, already in paise. */
export interface PricingSettings {
  shipping: ShippingRules
  loyalty: LoyaltyRules
  /** The seller's state, which decides CGST+SGST against IGST. */
  companyState: string
}

export interface PriceCartInput {
  lines: readonly PriceableLine[]
  settings: PricingSettings
  /** Null when no code is applied, or when the submitted code matched nothing. */
  coupon: CouponRule | null
  /** Redemptions of this coupon by this customer already. Zero for a guest. */
  couponUsageByCustomer?: number
  loyaltyPointsRequested?: number
  loyaltyBalance?: number
  /** Destination state. Null on the cart page, before an address is chosen. */
  shippingState?: string | null
  paymentMethod?: PaymentMethod
  now?: Date
}

export interface CartPricing {
  lines: PricedLine[]
  subtotal: Money
  shipping: Money
  shippingBase: Money
  codFee: Money
  isShippingFree: boolean
  /** How much more to spend for free carriage. Null once it is already free. */
  amountToFreeShipping: Money | null
  taxTotal: Money
  taxBreakup: TaxBreakup
  jurisdiction: TaxJurisdiction
  discount: Money
  loyaltyDiscount: Money
  grandTotal: Money
  /** Set when a code was applied successfully. */
  coupon: { id: number | string; code: string; freeShipping: boolean } | null
  /** Set when a code was submitted and refused. Mutually exclusive with `coupon`. */
  couponRejection: CouponRejection | null
  loyaltyPointsUsed: number
  loyaltyRejection: LoyaltyRejection | null
  /** The most points that could have been spent — drives the "use up to N points" hint. */
  loyaltyPointsAvailable: number
  /** Earned on delivery, not now. */
  pointsToEarn: number
  itemCount: number
}

/** Thrown when the totals do not reconcile. A bug in this module, never a user's fault. */
export class TotalsMismatchError extends Error {
  constructor(expected: Money, actual: Money) {
    super(
      `Order totals do not reconcile: components sum to ${expected.toPaise()} paise but the grand total is ${actual.toPaise()} paise`,
    )
    this.name = 'TotalsMismatchError'
  }
}

function priceLine(line: PriceableLine, jurisdiction: TaxJurisdiction): {
  priced: PricedLine
  breakup: TaxBreakup
} {
  if (!Number.isInteger(line.qty) || line.qty < 1) {
    throw new RangeError(`Cart line quantity must be a whole number of at least 1, received ${line.qty}`)
  }

  const lineSubtotal = line.unitPrice.multiply(line.qty)
  const tax = taxOn(lineSubtotal, line.taxRatePct)

  return {
    priced: {
      variantId: line.variantId,
      qty: line.qty,
      unitPrice: line.unitPrice,
      lineSubtotal,
      taxRatePct: line.taxRatePct,
      tax,
      lineTotal: lineSubtotal.add(tax),
    },
    // Split per line rather than once at the end: the halves of an odd amount are decided
    // line by line, so the breakup always sums to the tax on the lines that produced it.
    breakup: splitTax(tax, jurisdiction),
  }
}

/**
 * Price a cart.
 *
 * Pure: given the same lines, settings and clock it returns the same totals, which is what
 * lets the non-negotiable cases in CLAUDE.md §5 be table-driven tests rather than a checkout
 * run against a database.
 */
export function priceCart(input: PriceCartInput): CartPricing {
  const {
    lines,
    settings,
    coupon,
    couponUsageByCustomer = 0,
    loyaltyPointsRequested = 0,
    loyaltyBalance = 0,
    shippingState = null,
    paymentMethod = 'razorpay',
    now = new Date(),
  } = input

  const jurisdiction = taxJurisdiction(settings.companyState, shippingState)

  const priced: PricedLine[] = []
  let taxBreakup = emptyBreakup()

  for (const line of lines) {
    const { priced: pricedLine, breakup } = priceLine(line, jurisdiction)
    priced.push(pricedLine)
    taxBreakup = addBreakups(taxBreakup, breakup)
  }

  const subtotal = Money.sum(priced.map((line) => line.lineSubtotal))
  const taxTotal = breakupTotal(taxBreakup)

  // --- Coupon -------------------------------------------------------------
  const couponLines: CouponLine[] = lines.map((line, index) => ({
    productId: line.productId,
    categoryId: line.categoryId,
    // Index is safe: `priced` is built one entry per line, in order.
    amount: priced[index]?.lineSubtotal ?? Money.zero(),
  }))

  const evaluation: CouponEvaluation | null =
    coupon === null ? null : evaluateCoupon({ coupon, lines: couponLines, now, customerUsageCount: couponUsageByCustomer })

  const discount = evaluation?.ok === true ? evaluation.discount : Money.zero()
  const freeShippingCoupon = evaluation?.ok === true && evaluation.freeShipping

  // --- Loyalty ------------------------------------------------------------
  // Points apply to what is left after the coupon, so the same rupee is not discounted twice.
  const redeemableAgainst = subtotal.subtract(discount).clampToZero()
  const redemption = redeemPoints({
    requestedPoints: loyaltyPointsRequested,
    balance: loyaltyBalance,
    redeemableAgainst,
    rules: settings.loyalty,
  })

  const loyaltyDiscount = redemption.ok ? redemption.discount : Money.zero()

  // --- Shipping -----------------------------------------------------------
  const carriage = shippingFor({ subtotal, rules: settings.shipping, paymentMethod, freeShippingCoupon })

  // --- Grand total --------------------------------------------------------
  // Built from the **line totals**, each of which already carries its own tax. This is the
  // figure that has to agree with the invoice a customer reads line by line.
  const grandTotal = Money.sum(priced.map((line) => line.lineTotal))
    .add(carriage.total)
    .subtract(discount)
    .subtract(loyaltyDiscount)

  // The invariant from CLAUDE.md §5, asserted rather than assumed — and computed by a genuinely
  // different route, from the column totals the `orders` row stores. The two agreeing is what
  // proves the per-line CGST/SGST split did not gain or lose a paise on the way to `taxBreakup`.
  const expected = subtotal
    .add(carriage.total)
    .add(taxTotal)
    .subtract(discount)
    .subtract(loyaltyDiscount)

  if (!grandTotal.equals(expected)) {
    throw new TotalsMismatchError(expected, grandTotal)
  }
  if (grandTotal.isNegative()) {
    throw new TotalsMismatchError(Money.zero(), grandTotal)
  }

  return {
    lines: priced,
    subtotal,
    shipping: carriage.total,
    shippingBase: carriage.base,
    codFee: carriage.codFee,
    isShippingFree: carriage.isFree,
    amountToFreeShipping: carriage.amountToFreeShipping,
    taxTotal,
    taxBreakup,
    jurisdiction,
    discount,
    loyaltyDiscount,
    grandTotal,
    coupon:
      evaluation?.ok === true
        ? { id: evaluation.couponId, code: evaluation.code, freeShipping: evaluation.freeShipping }
        : null,
    couponRejection: evaluation !== null && !evaluation.ok ? evaluation.reason : null,
    loyaltyPointsUsed: redemption.ok ? redemption.points : 0,
    loyaltyRejection: redemption.ok ? null : redemption.reason,
    loyaltyPointsAvailable: maxRedeemablePoints({
      balance: loyaltyBalance,
      redeemableAgainst,
      rules: settings.loyalty,
    }),
    pointsToEarn: pointsEarned(subtotal, settings.loyalty),
    itemCount: priced.reduce((total, line) => total + line.qty, 0),
  }
}

/** The same totals as plain paise, for a component or a JSON response. */
export interface PricingView {
  subtotalPaise: number
  shippingPaise: number
  shippingBasePaise: number
  codFeePaise: number
  isShippingFree: boolean
  amountToFreeShippingPaise: number | null
  taxTotalPaise: number
  taxBreakup: { cgstPaise: number; sgstPaise: number; igstPaise: number }
  jurisdiction: TaxJurisdiction
  discountPaise: number
  loyaltyDiscountPaise: number
  grandTotalPaise: number
  couponCode: string | null
  couponRejection: CouponRejection | null
  loyaltyPointsUsed: number
  loyaltyRejection: LoyaltyRejection | null
  loyaltyPointsAvailable: number
  pointsToEarn: number
  itemCount: number
}

/**
 * Flatten pricing for the wire.
 *
 * `Money` has methods, so it cannot cross the server → client boundary as itself. This is the
 * render boundary CLAUDE.md §2 means by "format only at the render boundary": paise stay
 * integers, and a component decides how to display them.
 */
export function toPricingView(pricing: CartPricing): PricingView {
  return {
    subtotalPaise: pricing.subtotal.toPaise(),
    shippingPaise: pricing.shipping.toPaise(),
    shippingBasePaise: pricing.shippingBase.toPaise(),
    codFeePaise: pricing.codFee.toPaise(),
    isShippingFree: pricing.isShippingFree,
    amountToFreeShippingPaise: pricing.amountToFreeShipping?.toPaise() ?? null,
    taxTotalPaise: pricing.taxTotal.toPaise(),
    taxBreakup: {
      cgstPaise: pricing.taxBreakup.cgst.toPaise(),
      sgstPaise: pricing.taxBreakup.sgst.toPaise(),
      igstPaise: pricing.taxBreakup.igst.toPaise(),
    },
    jurisdiction: pricing.jurisdiction,
    discountPaise: pricing.discount.toPaise(),
    loyaltyDiscountPaise: pricing.loyaltyDiscount.toPaise(),
    grandTotalPaise: pricing.grandTotal.toPaise(),
    couponCode: pricing.coupon?.code ?? null,
    couponRejection: pricing.couponRejection,
    loyaltyPointsUsed: pricing.loyaltyPointsUsed,
    loyaltyRejection: pricing.loyaltyRejection,
    loyaltyPointsAvailable: pricing.loyaltyPointsAvailable,
    pointsToEarn: pricing.pointsToEarn,
    itemCount: pricing.itemCount,
  }
}
