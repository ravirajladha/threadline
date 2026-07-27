import { describe, expect, it } from 'vitest'

import { Money } from '@/lib/pricing/money'
import {
  LOYALTY_REJECTIONS,
  loyaltyRejectionMessage,
  maxRedeemablePoints,
  moneyToPoints,
  pointsEarned,
  pointsToMoney,
  redeemPoints,
  type LoyaltyRules,
} from '@/lib/pricing/loyalty'

const rules: LoyaltyRules = { enabled: true, earnPerRupee: 1, maxRedeemPct: 10, minRedeem: 50 }

describe('point ↔ money conversion', () => {
  it('values a point at one rupee', () => {
    expect(pointsToMoney(150).toPaise()).toBe(15000)
  })

  it('rounds an amount down to whole points', () => {
    // 149.99 rupees is 149 points; the customer keeps the remainder rather than being
    // credited a fraction that cannot then be spent or reversed.
    expect(moneyToPoints(Money.fromPaise(14999))).toBe(149)
  })

  it('never returns negative points', () => {
    expect(moneyToPoints(Money.fromPaise(-500))).toBe(0)
  })

  it('rejects fractional or negative point counts', () => {
    expect(() => pointsToMoney(1.5)).toThrow(RangeError)
    expect(() => pointsToMoney(-10)).toThrow(RangeError)
  })
})

describe('pointsEarned', () => {
  it('awards one point per rupee of subtotal', () => {
    expect(pointsEarned(Money.fromPaise(129900), rules)).toBe(1299)
  })

  it('rounds down a part-rupee subtotal', () => {
    expect(pointsEarned(Money.fromPaise(129999), rules)).toBe(1299)
  })

  it('honours a different earn rate', () => {
    expect(pointsEarned(Money.fromPaise(100000), { ...rules, earnPerRupee: 2 })).toBe(2000)
  })

  it('awards nothing when loyalty is switched off', () => {
    expect(pointsEarned(Money.fromPaise(129900), { ...rules, enabled: false })).toBe(0)
  })
})

describe('maxRedeemablePoints', () => {
  it('caps at a percentage of the cart', () => {
    // 10% of ₹1,000 is ₹100, so 100 points however large the balance.
    expect(maxRedeemablePoints({ balance: 5000, redeemableAgainst: Money.fromPaise(100000), rules })).toBe(100)
  })

  it('caps at the balance when that is lower', () => {
    expect(maxRedeemablePoints({ balance: 60, redeemableAgainst: Money.fromPaise(100000), rules })).toBe(60)
  })

  it('returns zero when the cap falls below the minimum redemption', () => {
    // 10% of ₹400 is 40 points, under the 50-point minimum. Offering "redeem 40" here
    // is an error message waiting to happen.
    expect(maxRedeemablePoints({ balance: 5000, redeemableAgainst: Money.fromPaise(40000), rules })).toBe(0)
  })

  it('returns zero with no balance', () => {
    expect(maxRedeemablePoints({ balance: 0, redeemableAgainst: Money.fromPaise(100000), rules })).toBe(0)
  })

  it('returns zero when loyalty is switched off', () => {
    expect(
      maxRedeemablePoints({
        balance: 5000,
        redeemableAgainst: Money.fromPaise(100000),
        rules: { ...rules, enabled: false },
      }),
    ).toBe(0)
  })

  it('never exceeds what is left to pay', () => {
    const generous: LoyaltyRules = { ...rules, maxRedeemPct: 100, minRedeem: 1 }

    expect(maxRedeemablePoints({ balance: 100_000, redeemableAgainst: Money.fromPaise(25000), rules: generous })).toBe(250)
  })
})

describe('redeemPoints', () => {
  const redeemableAgainst = Money.fromPaise(500000) // ₹5,000 — 10% is 500 points

  it('redeems a valid request', () => {
    const result = redeemPoints({ requestedPoints: 200, balance: 1000, redeemableAgainst, rules })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.points).toBe(200)
      expect(result.discount.toPaise()).toBe(20000)
    }
  })

  it('treats zero as a successful no-op', () => {
    // The normal state of a checkout nobody touched.
    const result = redeemPoints({ requestedPoints: 0, balance: 1000, redeemableAgainst, rules })

    expect(result).toEqual({ ok: true, points: 0, discount: Money.zero() })
  })

  it('clamps a request above the percentage cap instead of refusing it', () => {
    // Asking for more than allowed means "use as many as you can", not "fail".
    const result = redeemPoints({ requestedPoints: 900, balance: 1000, redeemableAgainst, rules })

    expect(result.ok && result.points).toBe(500)
  })

  it('refuses a request above the balance', () => {
    expect(redeemPoints({ requestedPoints: 200, balance: 100, redeemableAgainst, rules })).toEqual({
      ok: false,
      reason: 'insufficient_balance',
    })
  })

  it('refuses a request below the minimum', () => {
    expect(redeemPoints({ requestedPoints: 10, balance: 1000, redeemableAgainst, rules })).toEqual({
      ok: false,
      reason: 'below_minimum',
    })
  })

  it('refuses when loyalty is off', () => {
    expect(
      redeemPoints({ requestedPoints: 200, balance: 1000, redeemableAgainst, rules: { ...rules, enabled: false } }),
    ).toEqual({ ok: false, reason: 'disabled' })
  })

  it('refuses when the cart is too small to reach the minimum', () => {
    const result = redeemPoints({
      requestedPoints: 60,
      balance: 1000,
      redeemableAgainst: Money.fromPaise(40000),
      rules,
    })

    expect(result).toEqual({ ok: false, reason: 'below_minimum' })
  })

  it('cannot discount a cart already fully paid for by a coupon', () => {
    const result = redeemPoints({ requestedPoints: 100, balance: 1000, redeemableAgainst: Money.zero(), rules })

    expect(result.ok).toBe(false)
  })
})

describe('loyaltyRejectionMessage', () => {
  it('has a sentence for every reason', () => {
    for (const reason of LOYALTY_REJECTIONS) {
      expect(loyaltyRejectionMessage(reason, rules).length).toBeGreaterThan(0)
    }
  })

  it('quotes the configured minimum rather than a hard-coded one', () => {
    expect(loyaltyRejectionMessage('below_minimum', { ...rules, minRedeem: 250 })).toContain('250')
  })
})
