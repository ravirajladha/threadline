import { describe, expect, it } from 'vitest'

import { Money } from '@/lib/pricing/money'
import { isCodAvailable, shippingFor, type ShippingRules } from '@/lib/pricing/shipping'

const rules: ShippingRules = {
  freeShippingThresholdPaise: 99900,
  flatShippingRatePaise: 7900,
  codEnabled: true,
  codFeePaise: 4900,
}

function charge(subtotalPaise: number, overrides: Partial<Parameters<typeof shippingFor>[0]> = {}) {
  return shippingFor({
    subtotal: Money.fromPaise(subtotalPaise),
    rules,
    paymentMethod: 'razorpay',
    freeShippingCoupon: false,
    ...overrides,
  })
}

describe('shippingFor', () => {
  it('charges the flat rate below the threshold', () => {
    const result = charge(50000)

    expect(result.total.toPaise()).toBe(7900)
    expect(result.isFree).toBe(false)
  })

  it('ships free exactly at the threshold', () => {
    // "Free shipping over ₹999" reading as ₹999.01 is what customers write in about.
    const result = charge(99900)

    expect(result.total.isZero()).toBe(true)
    expect(result.isFree).toBe(true)
    expect(result.amountToFreeShipping).toBeNull()
  })

  it('ships free above the threshold', () => {
    expect(charge(150000).isFree).toBe(true)
  })

  it('reports how much more is needed for free shipping', () => {
    expect(charge(50000).amountToFreeShipping?.toPaise()).toBe(49900)
  })

  it('waives carriage for a free-shipping coupon below the threshold', () => {
    const result = charge(50000, { freeShippingCoupon: true })

    expect(result.base.isZero()).toBe(true)
    expect(result.isFree).toBe(true)
  })

  it('still reports the shortfall when a coupon waived the charge', () => {
    // The cart genuinely is below the threshold; the coupon is why it ships free. Keeping
    // these separate means the progress bar does not claim the cart qualified on its own.
    const result = charge(50000, { freeShippingCoupon: true })

    expect(result.amountToFreeShipping?.toPaise()).toBe(49900)
  })

  it('adds the COD fee on top of carriage', () => {
    const result = charge(50000, { paymentMethod: 'cod' })

    expect(result.base.toPaise()).toBe(7900)
    expect(result.codFee.toPaise()).toBe(4900)
    expect(result.total.toPaise()).toBe(12800)
  })

  it('charges the COD fee even on a free-shipping cart', () => {
    const result = charge(150000, { paymentMethod: 'cod' })

    expect(result.base.isZero()).toBe(true)
    expect(result.total.toPaise()).toBe(4900)
  })

  it('never charges a COD fee for a prepaid order', () => {
    expect(charge(50000, { paymentMethod: 'razorpay' }).codFee.isZero()).toBe(true)
  })

  it('ignores the COD fee when the owner has switched COD off', () => {
    const result = shippingFor({
      subtotal: Money.fromPaise(50000),
      rules: { ...rules, codEnabled: false },
      paymentMethod: 'cod',
      freeShippingCoupon: false,
    })

    expect(result.codFee.isZero()).toBe(true)
  })

  it('charges nothing when there is nothing to ship', () => {
    // A zero subtotal is below the threshold, so the naive answer is the flat rate — postage
    // quoted on a parcel that does not exist. `itemCount` is what makes "nothing ships" a
    // different case from "a cheap cart ships".
    const result = charge(0, { itemCount: 0 })

    expect(result.total.isZero()).toBe(true)
    expect(result.isFree).toBe(true)
    expect(result.amountToFreeShipping).toBeNull()
  })

  it('charges no COD fee when nothing ships', () => {
    expect(charge(0, { itemCount: 0, paymentMethod: 'cod' }).codFee.isZero()).toBe(true)
  })

  it('assumes something is shipping when the caller does not say', () => {
    // Keeps the simple call site — one amount in, carriage out — working unchanged.
    expect(charge(50000).total.toPaise()).toBe(7900)
  })
})

describe('isCodAvailable', () => {
  it('follows the setting', () => {
    expect(isCodAvailable(rules)).toBe(true)
    expect(isCodAvailable({ ...rules, codEnabled: false })).toBe(false)
  })
})
