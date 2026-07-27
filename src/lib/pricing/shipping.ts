/**
 * Shipping and the COD fee.
 *
 * Every number this module uses arrives as an argument, read from the `settings` global.
 * `if (subtotal >= 99900)` would be a deploy every time marketing changes its mind about free
 * shipping, which is exactly the rule CLAUDE.md §3 exists to prevent.
 *
 * The COD fee is folded into the shipping figure the order stores, because `orders` has one
 * shipping column and an invoice with a mystery extra line is worse than a slightly broad
 * label. The breakdown is still returned so the checkout summary can itemise it honestly.
 */
import { Money } from './money'
import type { PaymentMethod } from '@/types'

/** The shipping half of `settings`, in paise. */
export interface ShippingRules {
  freeShippingThresholdPaise: number
  flatShippingRatePaise: number
  codEnabled: boolean
  codFeePaise: number
}

export interface ShippingInput {
  /** Cart subtotal before tax and discounts — what the threshold is measured against. */
  subtotal: Money
  rules: ShippingRules
  paymentMethod: PaymentMethod
  /** True when an applied coupon is of type `free_shipping`. */
  freeShippingCoupon: boolean
  /**
   * Units actually being shipped. Zero means nothing is: no carriage, no COD fee.
   *
   * Without this, an empty cart — or one whose every line sold out — is below the free-shipping
   * threshold and therefore charged the flat rate, so the summary quotes postage on a parcel
   * that does not exist. Defaults to 1 so a caller pricing a single amount is unaffected.
   */
  itemCount?: number
}

export interface ShippingCharge {
  /** Carriage before any COD fee. */
  base: Money
  codFee: Money
  /** What the order records and the customer pays. */
  total: Money
  /** Whether carriage was waived, either by the threshold or by a coupon. */
  isFree: boolean
  /** How much more the customer would have to spend to ship free. Null once it already is. */
  amountToFreeShipping: Money | null
}

/**
 * Whether cash on delivery may be offered at all.
 *
 * Checked at checkout as well as rendered, because a hidden radio button is not access control
 * (OWASP A04) — a COD order must be refused server-side when the owner has switched it off.
 */
export function isCodAvailable(rules: ShippingRules): boolean {
  return rules.codEnabled
}

/**
 * The carriage for a cart.
 *
 * The threshold is inclusive: a cart exactly at the free-shipping figure ships free, because
 * "free shipping over ₹999" reading as "₹999.01" is the sort of thing customers write in about.
 */
export function shippingFor(input: ShippingInput): ShippingCharge {
  const { subtotal, rules, paymentMethod, freeShippingCoupon, itemCount = 1 } = input

  const threshold = Money.fromPaise(rules.freeShippingThresholdPaise)
  const flatRate = Money.fromPaise(rules.flatShippingRatePaise)

  if (itemCount <= 0) {
    return {
      base: Money.zero(),
      codFee: Money.zero(),
      total: Money.zero(),
      isFree: true,
      amountToFreeShipping: null,
    }
  }

  const meetsThreshold = subtotal.greaterThanOrEqual(threshold)
  const isFree = meetsThreshold || freeShippingCoupon

  const base = isFree ? Money.zero() : flatRate
  const codFee =
    paymentMethod === 'cod' && rules.codEnabled ? Money.fromPaise(rules.codFeePaise) : Money.zero()

  return {
    base,
    codFee,
    total: base.add(codFee),
    isFree,
    amountToFreeShipping: meetsThreshold ? null : threshold.subtract(subtotal),
  }
}
