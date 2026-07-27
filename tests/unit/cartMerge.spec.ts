import { describe, expect, it } from 'vitest'

import { mergeCoupon, mergeItems } from '@/lib/cart/merge'
import { MAX_LINE_QTY, type CartItem } from '@/lib/cart/types'

const plenty = () => 100

function item(variantId: number | string, qty: number, priceAtAddPaise = 129900): CartItem {
  return { variantId, qty, priceAtAddPaise }
}

describe('mergeItems', () => {
  it('keeps the customer’s cart when the guest cart is empty', () => {
    expect(mergeItems([item(1, 2)], [], plenty)).toEqual([item(1, 2)])
  })

  it('adopts the guest cart when the customer has none', () => {
    // The defect this exists to prevent: signing in to check out and watching the cart empty.
    expect(mergeItems([], [item(1, 2)], plenty)).toEqual([item(1, 2)])
  })

  it('unions distinct variants', () => {
    const result = mergeItems([item(1, 1)], [item(2, 3)], plenty)

    expect(result.map((i) => i.variantId)).toEqual([1, 2])
  })

  it('sums quantities of the same variant', () => {
    // Two in each cart means they wanted more than one; four is the honest reading.
    const result = mergeItems([item(1, 2)], [item(1, 2)], plenty)

    expect(result).toHaveLength(1)
    expect(result[0]?.qty).toBe(4)
  })

  it('matches the same variant across id number and string forms', () => {
    const result = mergeItems([item(1, 2)], [item('1', 1)], plenty)

    expect(result).toHaveLength(1)
    expect(result[0]?.qty).toBe(3)
  })

  it('clamps a summed line to available stock', () => {
    const result = mergeItems([item(1, 5)], [item(1, 5)], () => 3)

    expect(result[0]?.qty).toBe(3)
  })

  it('clamps a summed line to the per-line maximum', () => {
    const result = mergeItems([item(1, 8)], [item(1, 8)], plenty)

    expect(result[0]?.qty).toBe(MAX_LINE_QTY)
  })

  it('drops anything that sold out while the cart was waiting', () => {
    const result = mergeItems([item(1, 2)], [item(2, 1)], (id) => (String(id) === '1' ? 0 : 5))

    expect(result.map((i) => i.variantId)).toEqual([2])
  })

  it('takes the price the shopper most recently saw', () => {
    // The guest cart is the one they were just looking at, so its figure is the one that
    // decides whether the cart says "this price changed".
    const result = mergeItems([item(1, 1, 129900)], [item(1, 1, 99900)], plenty)

    expect(result[0]?.priceAtAddPaise).toBe(99900)
  })

  it('orders the customer’s existing lines first', () => {
    const result = mergeItems([item(5, 1), item(6, 1)], [item(7, 1), item(5, 1)], plenty)

    expect(result.map((i) => i.variantId)).toEqual([5, 6, 7])
  })

  it('merges two empty carts to nothing', () => {
    expect(mergeItems([], [], plenty)).toEqual([])
  })

  it('never mutates either input', () => {
    const customer = [item(1, 2)]
    const guest = [item(1, 2)]
    mergeItems(customer, guest, plenty)

    expect(customer[0]?.qty).toBe(2)
    expect(guest[0]?.qty).toBe(2)
  })
})

describe('mergeCoupon', () => {
  it('prefers the code the shopper just typed', () => {
    expect(mergeCoupon(1, 2)).toBe(2)
  })

  it('keeps the stored code when the guest had none', () => {
    expect(mergeCoupon(1, null)).toBe(1)
  })

  it('is null when neither cart had one', () => {
    expect(mergeCoupon(null, null)).toBeNull()
  })
})
