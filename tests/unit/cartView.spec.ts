import { describe, expect, it } from 'vitest'

import { buildCartView, couponStillValid, type BuildCartInput } from '@/lib/cart/cartView'
import type { CartItem, CartVariantSnapshot } from '@/lib/cart/types'
import type { CouponRule } from '@/lib/pricing/coupon'
import type { PricingSettings } from '@/lib/pricing/totals'

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

function snapshot(overrides: Partial<CartVariantSnapshot> = {}): CartVariantSnapshot {
  return {
    variantId: 1,
    sku: 'OXF-BLU-M',
    productId: 10,
    productTitle: 'Oxford Shirt',
    productSlug: 'oxford-shirt',
    categoryId: 100,
    categorySlug: 'shirts',
    sizeLabel: 'M',
    colourName: 'Blue',
    colourHex: '#1e3a8a',
    image: null,
    unitPricePaise: 129900,
    taxRatePct: 5,
    availableQty: 8,
    isPurchasable: true,
    ...overrides,
  }
}

function item(overrides: Partial<CartItem> = {}): CartItem {
  return { variantId: 1, qty: 1, priceAtAddPaise: 129900, ...overrides }
}

function build(overrides: Partial<BuildCartInput> = {}) {
  return buildCartView({
    id: 1,
    items: [item()],
    snapshots: [snapshot()],
    settings,
    coupon: null,
    ...overrides,
  })
}

describe('buildCartView — pricing', () => {
  it('prices a healthy line from the server’s own figure', () => {
    const cart = build()

    expect(cart.lines[0]?.unitPricePaise).toBe(129900)
    expect(cart.pricing.subtotalPaise).toBe(129900)
    expect(cart.canCheckout).toBe(true)
  })

  it('charges the current price, not the price the cart recorded', () => {
    // The whole point of OWASP A04 here: a stored price is a claim, never an authority.
    // Editing priceAtAdd in a request body must change nothing about the charge.
    const cart = build({
      items: [item({ priceAtAddPaise: 1 })],
      snapshots: [snapshot({ unitPricePaise: 129900 })],
    })

    expect(cart.pricing.subtotalPaise).toBe(129900)
    expect(cart.lines[0]?.issue).toBe('price_changed')
  })

  it('lets a customer buy through a price change', () => {
    const cart = build({ items: [item({ priceAtAddPaise: 99900 })] })

    expect(cart.lines[0]?.issue).toBe('price_changed')
    expect(cart.blockingIssues).toEqual([])
    expect(cart.canCheckout).toBe(true)
  })

  it('totals always equal the sum of the line subtotals shown', () => {
    const cart = build({
      items: [item({ qty: 2 }), item({ variantId: 2, qty: 3 })],
      snapshots: [snapshot(), snapshot({ variantId: 2, sku: 'OXF-BLU-L', unitPricePaise: 99900 })],
    })

    const sum = cart.lines.reduce((total, line) => total + line.lineSubtotalPaise, 0)

    expect(cart.pricing.subtotalPaise).toBe(sum)
  })

  it('adds free shipping once the cart clears the threshold', () => {
    const cart = build({ items: [item({ qty: 1 })] })

    expect(cart.pricing.isShippingFree).toBe(true)
    expect(cart.pricing.shippingPaise).toBe(0)
  })

  it('prices an empty cart without failing', () => {
    const cart = build({ items: [], snapshots: [] })

    expect(cart.isEmpty).toBe(true)
    expect(cart.canCheckout).toBe(false)
    expect(cart.pricing.grandTotalPaise).toBe(0)
  })
})

describe('buildCartView — stale lines', () => {
  it('flags and blocks a deactivated variant', () => {
    const cart = build({ snapshots: [snapshot({ isPurchasable: false })] })

    expect(cart.lines[0]?.issue).toBe('unavailable')
    expect(cart.lines[0]?.payableQty).toBe(0)
    expect(cart.blockingIssues).toEqual(['unavailable'])
    expect(cart.canCheckout).toBe(false)
  })

  it('flags a variant that has sold out', () => {
    const cart = build({ snapshots: [snapshot({ availableQty: 0 })] })

    expect(cart.lines[0]?.issue).toBe('unavailable')
    expect(cart.pricing.subtotalPaise).toBe(0)
  })

  it('prices only what can be fulfilled when stock ran short', () => {
    const cart = build({ items: [item({ qty: 5 })], snapshots: [snapshot({ availableQty: 2 })] })

    expect(cart.lines[0]?.qty).toBe(5)
    expect(cart.lines[0]?.payableQty).toBe(2)
    expect(cart.lines[0]?.lineSubtotalPaise).toBe(129900 * 2)
    expect(cart.pricing.subtotalPaise).toBe(129900 * 2)
    expect(cart.blockingIssues).toEqual(['insufficient_stock'])
    expect(cart.canCheckout).toBe(false)
  })

  it('shows a line whose variant has vanished entirely, so it can be removed', () => {
    const cart = build({ snapshots: [] })

    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]?.issue).toBe('unavailable')
    expect(cart.canCheckout).toBe(false)
  })

  it('reports the most severe issue only', () => {
    // Unavailable and price-changed at once reads as unavailable; three warnings on one line
    // is a line nobody reads.
    const cart = build({
      items: [item({ qty: 5, priceAtAddPaise: 1 })],
      snapshots: [snapshot({ availableQty: 0 })],
    })

    expect(cart.lines[0]?.issue).toBe('unavailable')
  })

  it('does not mutate or trim the stored items', () => {
    // A read that writes races with itself across two tabs and silently deletes a shopper's
    // choice. The cart is flagged instead.
    const items = [item({ qty: 5 })]
    const cart = build({ items, snapshots: [snapshot({ availableQty: 1 })] })

    expect(items[0]?.qty).toBe(5)
    expect(cart.lines).toHaveLength(1)
  })

  it('still lets a healthy cart check out alongside a price notice', () => {
    const cart = build({
      items: [item(), item({ variantId: 2, priceAtAddPaise: 1 })],
      snapshots: [snapshot(), snapshot({ variantId: 2 })],
    })

    expect(cart.canCheckout).toBe(true)
  })
})

describe('buildCartView — coupons', () => {
  const coupon: CouponRule = {
    id: 1,
    code: 'SAVE10',
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
  }

  it('applies a valid coupon and reports the code', () => {
    const cart = build({ coupon })

    expect(cart.couponCode).toBe('SAVE10')
    expect(cart.pricing.discountPaise).toBe(12990)
    expect(cart.couponRejection).toBeNull()
  })

  it('reports a refusal without breaking the cart', () => {
    const cart = build({ coupon: { ...coupon, minCartValuePaise: 500000 } })

    expect(cart.couponCode).toBeNull()
    expect(cart.couponRejection).toBe('min_cart_not_met')
    expect(cart.canCheckout).toBe(true)
  })

  it('discounts only the eligible part of a scoped cart', () => {
    const cart = build({
      items: [item(), item({ variantId: 2 })],
      snapshots: [snapshot(), snapshot({ variantId: 2, categoryId: 999 })],
      coupon: { ...coupon, appliesTo: 'categories', categoryIds: [100] },
    })

    expect(cart.pricing.discountPaise).toBe(12990)
  })

  it('does not discount stock the cart cannot actually sell', () => {
    // The coupon is evaluated on payable amounts, so a sold-out line cannot inflate a
    // percentage discount against goods that are not being shipped.
    const cart = build({ items: [item({ qty: 5 })], snapshots: [snapshot({ availableQty: 1 })], coupon })

    expect(cart.pricing.discountPaise).toBe(12990)
  })
})

describe('couponStillValid', () => {
  const coupon: CouponRule = {
    id: 1,
    code: 'BIG',
    type: 'flat',
    value: 20000,
    minCartValuePaise: 200000,
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
  }

  it('holds while the cart still qualifies', () => {
    const cart = build({ items: [item({ qty: 2 })], coupon })

    expect(couponStillValid({ coupon, lines: cart.lines })).toBe(true)
  })

  it('falls away when the cart drops below the minimum', () => {
    // A code that was valid when typed stops qualifying when the cart shrinks. Honouring it
    // anyway is the difference between a discount and a leak.
    const cart = build({ items: [item({ qty: 1 })] })

    expect(couponStillValid({ coupon, lines: cart.lines })).toBe(false)
  })

  it('is false with no coupon', () => {
    expect(couponStillValid({ coupon: null, lines: [] })).toBe(false)
  })
})
