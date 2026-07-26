import { describe, expect, it } from 'vitest'

import { Money } from '@/lib/pricing/money'

describe('Money construction', () => {
  it('builds from paise', () => {
    expect(Money.fromPaise(129900).toPaise()).toBe(129900)
  })

  it('builds from rupees without floating point drift', () => {
    expect(Money.fromRupees(1299.99).toPaise()).toBe(129999)
    expect(Money.fromRupees(0.1).add(Money.fromRupees(0.2)).toPaise()).toBe(30)
  })

  it('rounds rupees half away from zero', () => {
    // 0.125 is exactly representable in binary, so this is a true .5 paise midpoint.
    expect(Money.fromRupees(0.125).toPaise()).toBe(13)
    expect(Money.fromRupees(-0.125).toPaise()).toBe(-13)
  })

  it('documents why rupee floats are never trusted for arithmetic', () => {
    // 1.005 is stored as 1.00499999999999989…, so it is genuinely below the midpoint
    // and rounds down. Callers must pass paise when the exact value matters.
    expect(Money.fromRupees(1.005).toPaise()).toBe(100)
    expect(Money.fromPaise(101).toPaise()).toBe(101)
  })

  it('rejects fractional paise', () => {
    expect(() => Money.fromPaise(10.5)).toThrow(RangeError)
  })

  it('rejects non-finite rupee input', () => {
    expect(() => Money.fromRupees(Number.NaN)).toThrow(RangeError)
    expect(() => Money.fromRupees(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('sums an empty list to zero', () => {
    expect(Money.sum([]).isZero()).toBe(true)
  })

  it('sums a list of amounts', () => {
    const amounts = [Money.fromRupees(100), Money.fromRupees(250.5), Money.fromRupees(0.5)]
    expect(Money.sum(amounts).toPaise()).toBe(35100)
  })
})

describe('Money arithmetic', () => {
  it('adds and subtracts', () => {
    const a = Money.fromRupees(1000)
    const b = Money.fromRupees(249.5)
    expect(a.add(b).toPaise()).toBe(124950)
    expect(a.subtract(b).toPaise()).toBe(75050)
  })

  it('is immutable — operations return new instances', () => {
    const original = Money.fromRupees(500)
    original.add(Money.fromRupees(100))
    expect(original.toPaise()).toBe(50000)
  })

  it('multiplies by a whole quantity', () => {
    expect(Money.fromRupees(799).multiply(3).toPaise()).toBe(239700)
  })

  it('rejects fractional quantities', () => {
    expect(() => Money.fromRupees(799).multiply(1.5)).toThrow(RangeError)
  })

  it('multiplying by zero yields zero', () => {
    expect(Money.fromRupees(799).multiply(0).isZero()).toBe(true)
  })

  it('takes a percentage, rounded to the nearest paise', () => {
    // 5% GST on ₹999 = ₹49.95
    expect(Money.fromRupees(999).percentage(5).toPaise()).toBe(4995)
    // 12% on ₹1,499 = ₹179.88
    expect(Money.fromRupees(1499).percentage(12).toPaise()).toBe(17988)
  })

  it('percentage rounds rather than truncates', () => {
    // 12% of ₹10.01 = ₹1.2012 → 120 paise
    expect(Money.fromRupees(10.01).percentage(12).toPaise()).toBe(120)
  })

  it('clamps negatives to zero so a discount cannot invert a total', () => {
    const total = Money.fromRupees(500).subtract(Money.fromRupees(800))
    expect(total.isNegative()).toBe(true)
    expect(total.clampToZero().isZero()).toBe(true)
  })

  it('caps an amount with min', () => {
    const discount = Money.fromRupees(600)
    const cartValue = Money.fromRupees(450)
    expect(discount.min(cartValue).toPaise()).toBe(45000)
  })

  it('picks the larger with max', () => {
    expect(Money.fromRupees(10).max(Money.fromRupees(25)).toPaise()).toBe(2500)
  })
})

describe('Money comparison', () => {
  it('compares amounts', () => {
    const small = Money.fromRupees(100)
    const large = Money.fromRupees(200)

    expect(large.greaterThan(small)).toBe(true)
    expect(small.lessThan(large)).toBe(true)
    expect(small.equals(Money.fromRupees(100))).toBe(true)
    expect(small.greaterThanOrEqual(Money.fromRupees(100))).toBe(true)
    expect(small.greaterThan(Money.fromRupees(100))).toBe(false)
  })
})

describe('Money output', () => {
  it('formats as Indian rupees', () => {
    // Non-breaking space and grouping vary by ICU build, so assert on the parts.
    const formatted = Money.fromRupees(129900).format()
    expect(formatted).toContain('₹')
    expect(formatted).toContain('1,29,900.00')
  })

  it('always shows two decimal places', () => {
    expect(Money.fromRupees(1000).format()).toContain('1,000.00')
  })

  it('serialises to paise so DB writes cannot round-trip through a float', () => {
    expect(JSON.stringify({ total: Money.fromRupees(1299.5) })).toBe('{"total":129950}')
  })

  it('converts back to rupees for display', () => {
    expect(Money.fromPaise(129950).toRupees()).toBe(1299.5)
  })
})

describe('Money in a realistic order total', () => {
  it('reconciles to the paise', () => {
    // 2 × ₹1,299 shirt + 1 × ₹2,499 jacket, 12% GST, ₹500 off, ₹99 shipping
    const shirts = Money.fromRupees(1299).multiply(2)
    const jacket = Money.fromRupees(2499)
    const subtotal = Money.sum([shirts, jacket])
    expect(subtotal.toPaise()).toBe(509700)

    const discount = Money.fromRupees(500).min(subtotal)
    const taxable = subtotal.subtract(discount)
    const tax = taxable.percentage(12)
    const shipping = Money.fromRupees(99)
    const grandTotal = taxable.add(tax).add(shipping)

    expect(taxable.toPaise()).toBe(459700)
    expect(tax.toPaise()).toBe(55164)
    expect(grandTotal.toPaise()).toBe(524764)
    expect(grandTotal.format()).toContain('5,247.64')
  })
})
