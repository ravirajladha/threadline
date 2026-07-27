/**
 * Coupon evaluation.
 *
 * One function decides whether a code applies and what it is worth. It returns either a
 * discount or a **typed reason** it was refused — not `null`, and not a thrown error. The
 * reason is what the checkout box turns into "This code expired on 12 June" rather than
 * "Invalid coupon", and having it as a union means every refusal path is enumerable and
 * therefore testable.
 *
 * Every limit field on the collection exists because it is a way a coupon gets abused:
 * no minimum cart turns a flat ₹200 off into a paid-for ₹1 order, no per-user limit lets one
 * customer redeem a launch code forty times, no scope lets a shoes code discount a jacket.
 *
 * Deliberately not this module's job: knowing whether the code exists, or how many times this
 * customer has already used it. Both are database questions, answered by the caller and passed
 * in — which is what keeps this pure and lets a test cover the twelfth redemption without
 * creating eleven orders.
 */
import { Money } from './money'
import type { CouponScope, CouponType } from '@/types'

/** Why a code was refused. Each one maps to a sentence the customer can act on. */
export const COUPON_REJECTIONS = [
  'unknown_code',
  'inactive',
  'not_started',
  'expired',
  'min_cart_not_met',
  'limit_total_reached',
  'limit_per_user_reached',
  'no_eligible_items',
  'zero_discount',
] as const
export type CouponRejection = (typeof COUPON_REJECTIONS)[number]

/**
 * A coupon as this module needs it — flattened out of the Payload document.
 *
 * Money fields are paise, `null` where the collection leaves them empty, because "no maximum
 * discount" and "a maximum discount of zero" are opposite instructions.
 */
export interface CouponRule {
  id: number | string
  code: string
  type: CouponType
  value: number
  minCartValuePaise: number | null
  maxDiscountPaise: number | null
  limitTotal: number | null
  limitPerUser: number | null
  usedCount: number
  startsAt: string | null
  endsAt: string | null
  appliesTo: CouponScope
  categoryIds: Array<number | string>
  productIds: Array<number | string>
  isActive: boolean
  stackable: boolean
}

/** One cart line, as far as coupon scoping is concerned. */
export interface CouponLine {
  productId: number | string
  /** Null when the product is uncategorised — such a line never matches a category scope. */
  categoryId: number | string | null
  /** unitPrice × qty, before tax. */
  amount: Money
}

export interface CouponInput {
  /** Null when the submitted code matched nothing. */
  coupon: CouponRule | null
  lines: readonly CouponLine[]
  now: Date
  /** How many times this customer has already redeemed this code. Zero for a guest. */
  customerUsageCount: number
}

export type CouponEvaluation =
  | {
      ok: true
      couponId: number | string
      code: string
      discount: Money
      freeShipping: boolean
      /** The part of the cart the discount was calculated against. */
      eligibleSubtotal: Money
    }
  | { ok: false; reason: CouponRejection }

function refuse(reason: CouponRejection): CouponEvaluation {
  return { ok: false, reason }
}

/** Ids compared as strings, because Payload hands back numbers here and strings there. */
function includesId(ids: ReadonlyArray<number | string>, id: number | string | null): boolean {
  if (id === null) return false
  return ids.some((candidate) => String(candidate) === String(id))
}

/**
 * The lines a coupon may discount.
 *
 * A scoped coupon with nothing in the cart to apply to is refused rather than silently worth
 * zero — the customer needs to be told their code is for a different category, not left
 * looking at an unchanged total.
 */
export function eligibleLines(coupon: CouponRule, lines: readonly CouponLine[]): CouponLine[] {
  if (coupon.appliesTo === 'all') return [...lines]

  if (coupon.appliesTo === 'categories') {
    return lines.filter((line) => includesId(coupon.categoryIds, line.categoryId))
  }

  return lines.filter((line) => includesId(coupon.productIds, line.productId))
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Evaluate a code against a cart.
 *
 * Order of the checks matters for the message the customer sees: existence, then whether the
 * code is live at all, then the window, then the cart, then the limits. A code that is both
 * expired and over its limit reads as expired, which is the more useful of the two.
 */
export function evaluateCoupon(input: CouponInput): CouponEvaluation {
  const { coupon, lines, now, customerUsageCount } = input

  if (coupon === null) return refuse('unknown_code')
  if (!coupon.isActive) return refuse('inactive')

  const startsAt = parseDate(coupon.startsAt)
  if (startsAt !== null && now.getTime() < startsAt.getTime()) return refuse('not_started')

  const endsAt = parseDate(coupon.endsAt)
  if (endsAt !== null && now.getTime() > endsAt.getTime()) return refuse('expired')

  const subtotal = Money.sum(lines.map((line) => line.amount))

  if (coupon.minCartValuePaise !== null) {
    if (subtotal.lessThan(Money.fromPaise(coupon.minCartValuePaise))) return refuse('min_cart_not_met')
  }

  // Limits are checked against counts the caller read, so "unlimited" is null rather than zero.
  if (coupon.limitTotal !== null && coupon.usedCount >= coupon.limitTotal) {
    return refuse('limit_total_reached')
  }
  if (coupon.limitPerUser !== null && customerUsageCount >= coupon.limitPerUser) {
    return refuse('limit_per_user_reached')
  }

  const eligible = eligibleLines(coupon, lines)
  if (eligible.length === 0) return refuse('no_eligible_items')

  const eligibleSubtotal = Money.sum(eligible.map((line) => line.amount))

  if (coupon.type === 'free_shipping') {
    return {
      ok: true,
      couponId: coupon.id,
      code: coupon.code,
      discount: Money.zero(),
      freeShipping: true,
      eligibleSubtotal,
    }
  }

  const raw =
    coupon.type === 'percent'
      ? eligibleSubtotal.percentage(coupon.value)
      : Money.fromPaise(coupon.value)

  // Two caps, both required. `maxDiscount` is the owner's ceiling on a percentage code; the
  // eligible subtotal is the arithmetic one — a discount larger than what it applies to would
  // make the line negative, and a negative total is not a discount, it is a refund.
  const capped =
    coupon.maxDiscountPaise !== null ? raw.min(Money.fromPaise(coupon.maxDiscountPaise)) : raw
  const discount = capped.min(eligibleSubtotal).clampToZero()

  if (discount.isZero()) return refuse('zero_discount')

  return {
    ok: true,
    couponId: coupon.id,
    code: coupon.code,
    discount,
    freeShipping: false,
    eligibleSubtotal,
  }
}

/** Customer-facing copy for a refusal. Never leaks a limit count or another customer's usage. */
export function couponRejectionMessage(reason: CouponRejection): string {
  switch (reason) {
    case 'unknown_code':
      return 'That code is not recognised.'
    case 'inactive':
      return 'That code is no longer available.'
    case 'not_started':
      return 'That code is not active yet.'
    case 'expired':
      return 'That code has expired.'
    case 'min_cart_not_met':
      return 'Your cart is below the minimum for this code.'
    case 'limit_total_reached':
      return 'That code has been fully redeemed.'
    case 'limit_per_user_reached':
      return 'You have already used that code.'
    case 'no_eligible_items':
      return 'That code does not apply to anything in your cart.'
    case 'zero_discount':
      return 'That code is worth nothing on this cart.'
  }
}
