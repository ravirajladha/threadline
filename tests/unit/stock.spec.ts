import { describe, expect, it } from 'vitest'

import { availableToSell, canFulfil, signedQty, stockOnHand } from '@/lib/inventory/stock'

describe('signedQty', () => {
  it('adds for "in" whatever sign the caller supplied', () => {
    expect(signedQty({ type: 'in', qty: 10 })).toBe(10)
    expect(signedQty({ type: 'in', qty: -10 })).toBe(10)
  })

  it('adds for "return" — stock coming back from a customer', () => {
    expect(signedQty({ type: 'return', qty: 2 })).toBe(2)
    expect(signedQty({ type: 'return', qty: -2 })).toBe(2)
  })

  it('subtracts for "out" whatever sign the caller supplied', () => {
    expect(signedQty({ type: 'out', qty: 3 })).toBe(-3)
    expect(signedQty({ type: 'out', qty: -3 })).toBe(-3)
  })

  it('subtracts for "damage"', () => {
    expect(signedQty({ type: 'damage', qty: 1 })).toBe(-1)
  })

  it('honours the sign for "adjust" — that is what a stock count correction is', () => {
    expect(signedQty({ type: 'adjust', qty: 5 })).toBe(5)
    expect(signedQty({ type: 'adjust', qty: -5 })).toBe(-5)
  })
})

describe('stockOnHand', () => {
  it('is zero for a variant with no movements', () => {
    expect(stockOnHand([])).toBe(0)
  })

  it('sums a realistic ledger', () => {
    expect(
      stockOnHand([
        { type: 'in', qty: 50 }, // opening delivery
        { type: 'out', qty: 12 }, // sold
        { type: 'return', qty: 2 }, // two came back
        { type: 'damage', qty: 1 }, // one unsellable
        { type: 'adjust', qty: -3 }, // stock count found three missing
      ]),
    ).toBe(36)
  })

  it('can go negative, so a discrepancy is visible rather than hidden', () => {
    expect(stockOnHand([{ type: 'in', qty: 5 }, { type: 'out', qty: 8 }])).toBe(-3)
  })
})

describe('availableToSell', () => {
  it('is stock minus what checkouts are holding', () => {
    expect(availableToSell(10, 3)).toBe(7)
  })

  it('floors at zero — never shows a negative count to a shopper', () => {
    expect(availableToSell(2, 5)).toBe(0)
    expect(availableToSell(-4, 0)).toBe(0)
  })

  it('is zero when every unit is reserved', () => {
    expect(availableToSell(4, 4)).toBe(0)
  })
})

describe('canFulfil', () => {
  it('allows a quantity that fits', () => {
    expect(canFulfil(10, 2, 8)).toBe(true)
  })

  it('refuses one unit more than is available', () => {
    expect(canFulfil(10, 2, 9)).toBe(false)
  })

  it('refuses the last unit once it is reserved — the oversell case', () => {
    expect(canFulfil(1, 1, 1)).toBe(false)
  })

  it('allows the last unit while it is free', () => {
    expect(canFulfil(1, 0, 1)).toBe(true)
  })

  it.each([0, -1])('refuses a quantity of %d', (qty) => {
    expect(canFulfil(10, 0, qty)).toBe(false)
  })
})
