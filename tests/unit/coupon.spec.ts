import { describe, expect, it } from 'vitest'

import { Money } from '@/lib/pricing/money'
import {
  COUPON_REJECTIONS,
  couponRejectionMessage,
  eligibleLines,
  evaluateCoupon,
  type CouponLine,
  type CouponRule,
} from '@/lib/pricing/coupon'

const NOW = new Date('2026-07-27T10:00:00.000Z')

function coupon(overrides: Partial<CouponRule> = {}): CouponRule {
  return {
    id: 1,
    code: 'WELCOME10',
    type: 'percent',
    value: 10,
    minCartValuePaise: null,
    maxDiscountPaise: null,
    limitTotal: null,
    limitPerUser: 1,
    usedCount: 0,
    startsAt: null,
    endsAt: null,
    appliesTo: 'all',
    categoryIds: [],
    productIds: [],
    isActive: true,
    stackable: false,
    ...overrides,
  }
}

function line(amountPaise: number, productId: number | string = 1, categoryId: number | string | null = 10): CouponLine {
  return { productId, categoryId, amount: Money.fromPaise(amountPaise) }
}

function evaluate(rule: CouponRule | null, lines: CouponLine[] = [line(100000)], customerUsageCount = 0) {
  return evaluateCoupon({ coupon: rule, lines, now: NOW, customerUsageCount })
}

describe('evaluateCoupon — discounts', () => {
  it('takes a percentage off the cart', () => {
    const result = evaluate(coupon({ type: 'percent', value: 10 }))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.discount.toPaise()).toBe(10000)
  })

  it('takes a flat amount off the cart', () => {
    const result = evaluate(coupon({ type: 'flat', value: 20000 }))

    expect(result.ok && result.discount.toPaise()).toBe(20000)
  })

  it('caps a percentage discount at maxDiscount', () => {
    const result = evaluate(coupon({ type: 'percent', value: 50, maxDiscountPaise: 30000 }))

    expect(result.ok && result.discount.toPaise()).toBe(30000)
  })

  it('never discounts more than the cart is worth', () => {
    // A ₹500 flat code on a ₹300 cart is ₹300 off, not a ₹200 refund.
    const result = evaluate(coupon({ type: 'flat', value: 50000 }), [line(30000)])

    expect(result.ok && result.discount.toPaise()).toBe(30000)
  })

  it('is worth nothing but true for free shipping', () => {
    const result = evaluate(coupon({ type: 'free_shipping', value: 0 }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.freeShipping).toBe(true)
      expect(result.discount.isZero()).toBe(true)
    }
  })

  it('rounds a percentage to the nearest paise', () => {
    // 10% of 99,999 paise is 9,999.9
    const result = evaluate(coupon({ value: 10 }), [line(99999)])

    expect(result.ok && result.discount.toPaise()).toBe(10000)
  })
})

describe('evaluateCoupon — refusals', () => {
  it('refuses a code that does not exist', () => {
    expect(evaluate(null)).toEqual({ ok: false, reason: 'unknown_code' })
  })

  it('refuses a deactivated code', () => {
    expect(evaluate(coupon({ isActive: false }))).toEqual({ ok: false, reason: 'inactive' })
  })

  it('refuses a code before its start date', () => {
    expect(evaluate(coupon({ startsAt: '2026-08-01T00:00:00.000Z' }))).toEqual({
      ok: false,
      reason: 'not_started',
    })
  })

  it('refuses a code after its end date', () => {
    expect(evaluate(coupon({ endsAt: '2026-07-26T23:59:59.000Z' }))).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('accepts a code inside its window', () => {
    const result = evaluate(
      coupon({ startsAt: '2026-07-01T00:00:00.000Z', endsAt: '2026-08-31T00:00:00.000Z' }),
    )

    expect(result.ok).toBe(true)
  })

  it('ignores an unparseable date rather than refusing on it', () => {
    // A malformed date in the database must not lock a live code out of every cart.
    expect(evaluate(coupon({ endsAt: 'not a date' })).ok).toBe(true)
  })

  it('refuses below the minimum cart value', () => {
    expect(evaluate(coupon({ minCartValuePaise: 200000 }))).toEqual({
      ok: false,
      reason: 'min_cart_not_met',
    })
  })

  it('accepts a cart exactly at the minimum', () => {
    expect(evaluate(coupon({ minCartValuePaise: 100000 })).ok).toBe(true)
  })

  it('measures the minimum against the whole cart, not the eligible part', () => {
    // "Spend ₹2,000 to get 10% off dresses" means spend ₹2,000 in total.
    const result = evaluateCoupon({
      coupon: coupon({ minCartValuePaise: 200000, appliesTo: 'categories', categoryIds: [10] }),
      lines: [line(100000, 1, 10), line(100000, 2, 99)],
      now: NOW,
      customerUsageCount: 0,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // …but the discount is only on the eligible ₹1,000.
      expect(result.discount.toPaise()).toBe(10000)
      expect(result.eligibleSubtotal.toPaise()).toBe(100000)
    }
  })

  it('refuses once the global limit is reached', () => {
    expect(evaluate(coupon({ limitTotal: 100, usedCount: 100 }))).toEqual({
      ok: false,
      reason: 'limit_total_reached',
    })
  })

  it('allows the last redemption before the global limit', () => {
    expect(evaluate(coupon({ limitTotal: 100, usedCount: 99 })).ok).toBe(true)
  })

  it('treats a null global limit as unlimited', () => {
    expect(evaluate(coupon({ limitTotal: null, usedCount: 10_000 })).ok).toBe(true)
  })

  it('refuses a customer who has already used their allowance', () => {
    expect(evaluate(coupon({ limitPerUser: 1 }), [line(100000)], 1)).toEqual({
      ok: false,
      reason: 'limit_per_user_reached',
    })
  })

  it('allows a second use when the per-user limit is two', () => {
    expect(evaluate(coupon({ limitPerUser: 2 }), [line(100000)], 1).ok).toBe(true)
  })

  it('refuses when nothing in the cart is in scope', () => {
    const result = evaluateCoupon({
      coupon: coupon({ appliesTo: 'products', productIds: [99] }),
      lines: [line(100000, 1, 10)],
      now: NOW,
      customerUsageCount: 0,
    })

    expect(result).toEqual({ ok: false, reason: 'no_eligible_items' })
  })

  it('refuses a code that computes to nothing', () => {
    // A 0% code is a data-entry mistake; saying so beats an unchanged total.
    expect(evaluate(coupon({ type: 'percent', value: 0 }))).toEqual({
      ok: false,
      reason: 'zero_discount',
    })
  })

  it('reports expiry ahead of an exhausted limit', () => {
    const result = evaluate(coupon({ endsAt: '2026-01-01T00:00:00.000Z', limitTotal: 1, usedCount: 5 }))

    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses an empty cart as having nothing eligible', () => {
    expect(evaluate(coupon(), [])).toEqual({ ok: false, reason: 'no_eligible_items' })
  })
})

describe('eligibleLines', () => {
  const lines = [line(10000, 1, 10), line(20000, 2, 20), line(30000, 3, null)]

  it('returns everything for an "all" coupon', () => {
    expect(eligibleLines(coupon({ appliesTo: 'all' }), lines)).toHaveLength(3)
  })

  it('filters by category', () => {
    const result = eligibleLines(coupon({ appliesTo: 'categories', categoryIds: [20] }), lines)

    expect(result.map((l) => l.amount.toPaise())).toEqual([20000])
  })

  it('filters by product', () => {
    const result = eligibleLines(coupon({ appliesTo: 'products', productIds: [1, 3] }), lines)

    expect(result.map((l) => l.amount.toPaise())).toEqual([10000, 30000])
  })

  it('never matches an uncategorised line against a category scope', () => {
    const result = eligibleLines(coupon({ appliesTo: 'categories', categoryIds: [10, 20] }), lines)

    expect(result).toHaveLength(2)
  })

  it('compares ids across number and string forms', () => {
    // Payload returns a numeric id from one query and a string from another; a coupon must
    // not stop working because of which route loaded it.
    const result = eligibleLines(coupon({ appliesTo: 'products', productIds: ['2'] }), lines)

    expect(result.map((l) => l.amount.toPaise())).toEqual([20000])
  })
})

describe('couponRejectionMessage', () => {
  it('has a sentence for every reason', () => {
    for (const reason of COUPON_REJECTIONS) {
      expect(couponRejectionMessage(reason).length).toBeGreaterThan(0)
    }
  })

  it('never reveals how many redemptions are left', () => {
    // Leaking "3 of 100 used" hands an attacker a live counter to scrape.
    expect(couponRejectionMessage('limit_total_reached')).not.toMatch(/\d/)
  })
})
