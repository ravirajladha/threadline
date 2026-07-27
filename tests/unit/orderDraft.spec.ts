import { describe, expect, it } from 'vitest'

import { buildCartView } from '@/lib/cart/cartView'
import type { CartVariantSnapshot } from '@/lib/cart/types'
import { Money } from '@/lib/pricing/money'
import { priceCart, type PricingSettings } from '@/lib/pricing/totals'
import type { AddressSnapshot } from '@/lib/orders/address'
import {
  assertDraftReconciles,
  buildOrderDraft,
  DraftReconciliationError,
  EmptyOrderError,
  reservationRequestsFor,
  type BuildOrderDraftInput,
} from '@/lib/orders/draft'

const settings: PricingSettings = {
  shipping: { freeShippingThresholdPaise: 99900, flatShippingRatePaise: 7900, codEnabled: true, codFeePaise: 4900 },
  loyalty: { enabled: true, earnPerRupee: 1, maxRedeemPct: 10, minRedeem: 50 },
  companyState: 'Karnataka',
}

const address: AddressSnapshot = {
  name: 'Asha Menon',
  phone: '9876543210',
  line1: '14 Lavelle Road',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  country: 'India',
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
    image: { id: 55, url: '/media/shirt.webp', alt: 'Oxford Shirt', width: 800, height: 1000, colourId: 7 },
    unitPricePaise: 129900,
    taxRatePct: 5,
    availableQty: 8,
    isPurchasable: true,
    ...overrides,
  }
}

function draftFrom(
  snapshots: CartVariantSnapshot[],
  items: Array<{ variantId: number | string; qty: number }>,
  overrides: Partial<BuildOrderDraftInput> = {},
) {
  const cart = buildCartView({
    id: 1,
    items: items.map((item) => ({ ...item, priceAtAddPaise: 129900 })),
    snapshots,
    settings,
    coupon: null,
    options: { shippingState: address.state },
  })

  const pricing = priceCart({
    lines: cart.lines
      .filter((line) => line.payableQty > 0)
      .map((line) => ({
        variantId: line.variantId,
        productId: line.productId,
        categoryId: line.categoryId,
        qty: line.payableQty,
        unitPrice: Money.fromPaise(line.unitPricePaise),
        taxRatePct: line.taxRatePct,
      })),
    settings,
    coupon: null,
    shippingState: address.state,
  })

  return buildOrderDraft({
    orderNumber: 'TL-260727-0001',
    customerId: 7,
    email: 'asha@example.com',
    phone: '9876543210',
    shippingAddress: address,
    billingAddress: address,
    lines: cart.lines,
    pricing,
    paymentMethod: 'razorpay',
    placedAt: new Date('2026-07-27T09:00:00.000Z'),
    ...overrides,
  })
}

describe('buildOrderDraft — the snapshot', () => {
  it('copies every display field off the variant', () => {
    // A product renamed or repriced next month must not rewrite an order placed today.
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 2 }])
    const item = draft.items[0]

    expect(item).toMatchObject({
      variant: 1,
      sku: 'OXF-BLU-M',
      productTitle: 'Oxford Shirt',
      sizeLabel: 'M',
      colourName: 'Blue',
      image: 55,
      qty: 2,
      unitPrice: 129900,
      taxRatePct: 5,
    })
  })

  it('stores the image as an id, not a URL that will move', () => {
    expect(draftFrom([snapshot()], [{ variantId: 1, qty: 1 }]).items[0]?.image).toBe(55)
  })

  it('tolerates a line with no image', () => {
    expect(draftFrom([snapshot({ image: null })], [{ variantId: 1, qty: 1 }]).items[0]?.image).toBeNull()
  })

  it('puts tax inside the line total', () => {
    const item = draftFrom([snapshot()], [{ variantId: 1, qty: 2 }]).items[0]

    expect(item?.taxAmount).toBe(12990)
    expect(item?.lineTotal).toBe(259800 + 12990)
  })

  it('leaves out a line that cannot be fulfilled', () => {
    const draft = draftFrom(
      [snapshot(), snapshot({ variantId: 2, sku: 'OXF-BLU-L', availableQty: 0 })],
      [
        { variantId: 1, qty: 1 },
        { variantId: 2, qty: 1 },
      ],
    )

    expect(draft.items.map((item) => item.variant)).toEqual([1])
  })

  it('refuses to build an order with nothing in it', () => {
    expect(() => draftFrom([snapshot({ availableQty: 0 })], [{ variantId: 1, qty: 1 }])).toThrow(EmptyOrderError)
  })
})

describe('buildOrderDraft — the order row', () => {
  it('starts a prepaid order pending and unpaid', () => {
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 1 }])

    expect(draft.order.status).toBe('pending')
    expect(draft.order.paymentStatus).toBe('pending')
  })

  it('starts a COD order confirmed but unpaid', () => {
    // The other way round either ships goods nobody paid for, or leaves every cash order
    // waiting behind a payment that will never arrive.
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 1 }], { paymentMethod: 'cod' })

    expect(draft.order.status).toBe('confirmed')
    expect(draft.order.paymentStatus).toBe('pending')
  })

  it('records the CGST/SGST split for a local sale', () => {
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 1 }])

    expect(draft.order.taxBreakup.cgst + draft.order.taxBreakup.sgst).toBe(draft.order.taxTotal)
    expect(draft.order.taxBreakup.igst).toBe(0)
  })

  it('writes the order number and the placed timestamp', () => {
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 1 }])

    expect(draft.order.orderNumber).toBe('TL-260727-0001')
    expect(draft.order.placedAt).toBe('2026-07-27T09:00:00.000Z')
  })

  it('carries a guest order with no customer', () => {
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 1 }], { customerId: null })

    expect(draft.order.customer).toBeNull()
    expect(draft.order.email).toBe('asha@example.com')
  })
})

describe('assertDraftReconciles', () => {
  it('passes a well-formed draft', () => {
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 3 }])

    expect(() => assertDraftReconciles(draft)).not.toThrow()
  })

  it('catches a line that lost a unit on the way across', () => {
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 3 }])
    const broken = { ...draft, items: draft.items.map((item) => ({ ...item, qty: item.qty - 1 })) }

    expect(() => assertDraftReconciles(broken)).toThrow(DraftReconciliationError)
  })

  it('catches a tax breakup that no longer sums to the tax total', () => {
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 1 }])
    const broken = { ...draft, order: { ...draft.order, taxBreakup: { cgst: 1, sgst: 1, igst: 0 } } }

    expect(() => assertDraftReconciles(broken)).toThrow(DraftReconciliationError)
  })

  it('refuses an order carrying both IGST and CGST', () => {
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 1 }])
    const half = Math.floor(draft.order.taxTotal / 2)
    const broken = {
      ...draft,
      order: {
        ...draft.order,
        taxBreakup: { cgst: half, sgst: 0, igst: draft.order.taxTotal - half },
      },
    }

    expect(() => assertDraftReconciles(broken)).toThrow(/both IGST and CGST/)
  })

  it('catches a doctored grand total', () => {
    // The last gate before an order becomes permanent.
    const draft = draftFrom([snapshot()], [{ variantId: 1, qty: 1 }])
    const broken = { ...draft, order: { ...draft.order, grandTotal: 1 } }

    expect(() => assertDraftReconciles(broken)).toThrow(DraftReconciliationError)
  })
})

describe('reservationRequestsFor', () => {
  it('asks for exactly what the order lines committed to', () => {
    const draft = draftFrom(
      [snapshot(), snapshot({ variantId: 2, sku: 'OXF-BLU-L' })],
      [
        { variantId: 1, qty: 2 },
        { variantId: 2, qty: 1 },
      ],
    )

    expect(reservationRequestsFor(draft)).toEqual([
      { variantId: 1, qty: 2 },
      { variantId: 2, qty: 1 },
    ])
  })
})
