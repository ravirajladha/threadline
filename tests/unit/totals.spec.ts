import { describe, expect, it } from 'vitest'

import { Money } from '@/lib/pricing/money'
import type { CouponRule } from '@/lib/pricing/coupon'
import { breakupTotal } from '@/lib/pricing/tax'
import {
  priceCart,
  toPricingView,
  TotalsMismatchError,
  type PriceableLine,
  type PricingSettings,
} from '@/lib/pricing/totals'

const settings: PricingSettings = {
  shipping: {
    freeShippingThresholdPaise: 99900,
    flatShippingRatePaise: 7900,
    codEnabled: true,
    codFeePaise: 4900,
  },
  loyalty: { enabled: true, earnPerRupee: 1, maxRedeemPct: 10, minRedeem: 50 },
  companyState: 'Karnataka',
}

function line(overrides: Partial<PriceableLine> = {}): PriceableLine {
  return {
    variantId: 1,
    productId: 1,
    categoryId: 10,
    qty: 1,
    unitPrice: Money.fromPaise(50000),
    taxRatePct: 5,
    ...overrides,
  }
}

function coupon(overrides: Partial<CouponRule> = {}): CouponRule {
  return {
    id: 1,
    code: 'SAVE10',
    type: 'percent',
    value: 10,
    minCartValuePaise: null,
    maxDiscountPaise: null,
    limitTotal: null,
    limitPerUser: null,
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

/** The invariant from CLAUDE.md §5, checked from outside the module as well as inside it. */
function expectReconciled(pricing: ReturnType<typeof priceCart>) {
  const expected = pricing.subtotal
    .add(pricing.shipping)
    .add(pricing.taxTotal)
    .subtract(pricing.discount)
    .subtract(pricing.loyaltyDiscount)

  expect(pricing.grandTotal.toPaise()).toBe(expected.toPaise())
  expect(breakupTotal(pricing.taxBreakup).toPaise()).toBe(pricing.taxTotal.toPaise())
  expect(pricing.grandTotal.isNegative()).toBe(false)
}

describe('priceCart — lines and subtotal', () => {
  it('multiplies unit price by quantity', () => {
    const pricing = priceCart({ lines: [line({ qty: 3 })], settings, coupon: null })

    expect(pricing.subtotal.toPaise()).toBe(150000)
    expect(pricing.lines[0]?.lineSubtotal.toPaise()).toBe(150000)
    expect(pricing.itemCount).toBe(3)
  })

  it('sums several lines at different tax rates', () => {
    const pricing = priceCart({
      lines: [line({ unitPrice: Money.fromPaise(50000), taxRatePct: 5 }), line({ variantId: 2, unitPrice: Money.fromPaise(120000), taxRatePct: 12 })],
      settings,
      coupon: null,
    })

    expect(pricing.subtotal.toPaise()).toBe(170000)
    expect(pricing.taxTotal.toPaise()).toBe(2500 + 14400)
    expectReconciled(pricing)
  })

  it('prices an empty cart to zero without throwing', () => {
    const pricing = priceCart({ lines: [], settings, coupon: null })

    expect(pricing.subtotal.isZero()).toBe(true)
    expect(pricing.itemCount).toBe(0)
    expectReconciled(pricing)
  })

  it('rejects a fractional or zero quantity', () => {
    expect(() => priceCart({ lines: [line({ qty: 0 })], settings, coupon: null })).toThrow(RangeError)
    expect(() => priceCart({ lines: [line({ qty: 1.5 })], settings, coupon: null })).toThrow(RangeError)
  })

  it('carries tax inside each line total', () => {
    const pricing = priceCart({ lines: [line()], settings, coupon: null })

    expect(pricing.lines[0]?.lineTotal.toPaise()).toBe(50000 + 2500)
  })
})

describe('priceCart — GST', () => {
  it('splits CGST and SGST for a sale inside the seller’s state', () => {
    const pricing = priceCart({ lines: [line()], settings, coupon: null, shippingState: 'Karnataka' })

    expect(pricing.jurisdiction).toBe('intra_state')
    expect(pricing.taxBreakup.cgst.toPaise()).toBe(1250)
    expect(pricing.taxBreakup.sgst.toPaise()).toBe(1250)
    expect(pricing.taxBreakup.igst.isZero()).toBe(true)
  })

  it('charges IGST across states, and never both', () => {
    const pricing = priceCart({ lines: [line()], settings, coupon: null, shippingState: 'Kerala' })

    expect(pricing.jurisdiction).toBe('inter_state')
    expect(pricing.taxBreakup.igst.toPaise()).toBe(2500)
    expect(pricing.taxBreakup.cgst.isZero()).toBe(true)
    expect(pricing.taxBreakup.sgst.isZero()).toBe(true)
  })

  it('reconciles an odd tax amount split across lines', () => {
    // 5% of 49,999 paise is 2,499.95 → 2,500, halved as 1,250/1,250. Two lines of an amount
    // whose tax is genuinely odd is where a double-rounding bug would surface.
    const pricing = priceCart({
      lines: [line({ unitPrice: Money.fromPaise(9999) }), line({ variantId: 2, unitPrice: Money.fromPaise(9999) })],
      settings,
      coupon: null,
      shippingState: 'Karnataka',
    })

    expect(pricing.taxTotal.toPaise()).toBe(1000)
    expectReconciled(pricing)
  })
})

describe('priceCart — coupon', () => {
  it('applies a valid code and reports it', () => {
    const pricing = priceCart({ lines: [line({ qty: 2 })], settings, coupon: coupon() })

    expect(pricing.discount.toPaise()).toBe(10000)
    expect(pricing.coupon?.code).toBe('SAVE10')
    expect(pricing.couponRejection).toBeNull()
    expectReconciled(pricing)
  })

  it('records the refusal and charges full price', () => {
    const pricing = priceCart({ lines: [line()], settings, coupon: coupon({ isActive: false }) })

    expect(pricing.discount.isZero()).toBe(true)
    expect(pricing.coupon).toBeNull()
    expect(pricing.couponRejection).toBe('inactive')
    expectReconciled(pricing)
  })

  it('waives shipping for a free-shipping code below the threshold', () => {
    const pricing = priceCart({
      lines: [line({ unitPrice: Money.fromPaise(30000) })],
      settings,
      coupon: coupon({ type: 'free_shipping', value: 0 }),
    })

    expect(pricing.shipping.isZero()).toBe(true)
    expect(pricing.discount.isZero()).toBe(true)
    expectReconciled(pricing)
  })

  it('taxes the undiscounted line amount', () => {
    // Documented in totals.ts: tax is computed before the coupon comes off. Pinning it here
    // so a change to that order is a deliberate decision, not a silent one.
    const pricing = priceCart({ lines: [line()], settings, coupon: coupon({ type: 'flat', value: 25000 }) })

    expect(pricing.taxTotal.toPaise()).toBe(2500)
  })

  it('passes the customer’s usage count through to the limit check', () => {
    const pricing = priceCart({
      lines: [line()],
      settings,
      coupon: coupon({ limitPerUser: 1 }),
      couponUsageByCustomer: 1,
    })

    expect(pricing.couponRejection).toBe('limit_per_user_reached')
  })
})

describe('priceCart — loyalty', () => {
  const bigCart = [line({ unitPrice: Money.fromPaise(500000) })]

  it('redeems points against the cart', () => {
    const pricing = priceCart({
      lines: bigCart,
      settings,
      coupon: null,
      loyaltyPointsRequested: 300,
      loyaltyBalance: 1000,
    })

    expect(pricing.loyaltyPointsUsed).toBe(300)
    expect(pricing.loyaltyDiscount.toPaise()).toBe(30000)
    expectReconciled(pricing)
  })

  it('applies points to what is left after a coupon', () => {
    // ₹5,000 cart, 10% off leaves ₹4,500, so the 10% points cap is 450 — not 500.
    const pricing = priceCart({
      lines: bigCart,
      settings,
      coupon: coupon(),
      loyaltyPointsRequested: 500,
      loyaltyBalance: 5000,
    })

    expect(pricing.loyaltyPointsUsed).toBe(450)
    expectReconciled(pricing)
  })

  it('records a refusal without blocking the cart', () => {
    const pricing = priceCart({
      lines: bigCart,
      settings,
      coupon: null,
      loyaltyPointsRequested: 300,
      loyaltyBalance: 100,
    })

    expect(pricing.loyaltyPointsUsed).toBe(0)
    expect(pricing.loyaltyRejection).toBe('insufficient_balance')
    expectReconciled(pricing)
  })

  it('reports what could be redeemed, for the checkout hint', () => {
    const pricing = priceCart({ lines: bigCart, settings, coupon: null, loyaltyBalance: 5000 })

    expect(pricing.loyaltyPointsAvailable).toBe(500)
  })

  it('reports the points the order will earn on delivery', () => {
    const pricing = priceCart({ lines: bigCart, settings, coupon: null })

    expect(pricing.pointsToEarn).toBe(5000)
  })
})

describe('priceCart — the reconciliation invariant', () => {
  it('reconciles with everything applied at once', () => {
    const pricing = priceCart({
      lines: [
        line({ unitPrice: Money.fromPaise(129999), qty: 2, taxRatePct: 5 }),
        line({ variantId: 2, productId: 2, categoryId: 20, unitPrice: Money.fromPaise(89999), qty: 3, taxRatePct: 12 }),
      ],
      settings,
      coupon: coupon({ type: 'percent', value: 7, maxDiscountPaise: 40000 }),
      loyaltyPointsRequested: 400,
      loyaltyBalance: 10_000,
      shippingState: 'Maharashtra',
      paymentMethod: 'cod',
    })

    expectReconciled(pricing)
    expect(pricing.codFee.toPaise()).toBe(4900)
    expect(pricing.jurisdiction).toBe('inter_state')
  })

  it('reconciles across a swept range of prices, quantities and rates', () => {
    // Cheap, and it is the only way to be confident about rounding: a single hand-picked
    // example is exactly the case that happens to work.
    for (let paise = 9995; paise <= 10_005; paise += 1) {
      for (const qty of [1, 2, 3, 7]) {
        for (const rate of [0, 5, 12, 18]) {
          for (const state of ['Karnataka', 'Kerala']) {
            const pricing = priceCart({
              lines: [line({ unitPrice: Money.fromPaise(paise), qty, taxRatePct: rate })],
              settings,
              coupon: coupon({ type: 'percent', value: 13 }),
              loyaltyPointsRequested: 50,
              loyaltyBalance: 500,
              shippingState: state,
            })

            expectReconciled(pricing)
          }
        }
      }
    }
  })

  it('never produces a negative total when discounts exceed the goods', () => {
    const pricing = priceCart({
      lines: [line({ unitPrice: Money.fromPaise(10000) })],
      settings,
      coupon: coupon({ type: 'flat', value: 10_000_000 }),
      loyaltyPointsRequested: 500,
      loyaltyBalance: 500,
    })

    expect(pricing.discount.toPaise()).toBe(10000)
    expect(pricing.loyaltyDiscount.isZero()).toBe(true)
    expectReconciled(pricing)
  })

  it('exposes a mismatch as a named error', () => {
    // There is no input that triggers this — that is the point of the guard. Constructing it
    // directly documents what a caller would see if the module were ever broken.
    const error = new TotalsMismatchError(Money.fromPaise(100), Money.fromPaise(99))

    expect(error.name).toBe('TotalsMismatchError')
    expect(error.message).toContain('99')
  })
})

describe('toPricingView', () => {
  it('flattens every amount to integer paise', () => {
    const view = toPricingView(
      priceCart({
        lines: [line({ qty: 2 })],
        settings,
        coupon: coupon(),
        loyaltyPointsRequested: 50,
        loyaltyBalance: 500,
        shippingState: 'Karnataka',
      }),
    )

    expect(view.subtotalPaise).toBe(100000)
    expect(view.couponCode).toBe('SAVE10')
    expect(view.taxBreakup.cgstPaise + view.taxBreakup.sgstPaise).toBe(view.taxTotalPaise)
    expect(Number.isInteger(view.grandTotalPaise)).toBe(true)
  })

  it('survives a JSON round trip, as the RSC boundary requires', () => {
    const view = toPricingView(priceCart({ lines: [line()], settings, coupon: null }))

    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })
})
