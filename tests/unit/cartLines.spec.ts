import { describe, expect, it } from 'vitest'

import {
  addLine,
  findLine,
  itemCount,
  normaliseQty,
  reconcileLines,
  removeLine,
  setLineQty,
} from '@/lib/cart/lines'
import { MAX_LINE_QTY, type CartItem } from '@/lib/cart/types'

const shirt: CartItem = { variantId: 1, qty: 2, priceAtAddPaise: 129900 }
const jeans: CartItem = { variantId: 2, qty: 1, priceAtAddPaise: 199900 }

describe('normaliseQty', () => {
  it('accepts a whole number', () => {
    expect(normaliseQty(3)).toBe(3)
  })

  it('accepts a numeric string, because a form body is text', () => {
    expect(normaliseQty('3')).toBe(3)
  })

  it('floors a fraction', () => {
    expect(normaliseQty(2.9)).toBe(2)
  })

  it('returns zero for anything unusable', () => {
    // Every one of these is something a request body can actually contain. None may reach
    // the database, and none is worth a 500 at a shopper.
    for (const value of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 'two', null, undefined, {}, []]) {
      expect(normaliseQty(value)).toBe(0)
    }
  })

  it('clamps to the ceiling', () => {
    expect(normaliseQty(1e9)).toBe(MAX_LINE_QTY)
    expect(normaliseQty(50, 4)).toBe(4)
  })
})

describe('addLine', () => {
  it('appends a new variant', () => {
    const result = addLine([], { variantId: 1, qty: 2, pricePaise: 129900, available: 10 })

    expect(result).toEqual([{ variantId: 1, qty: 2, priceAtAddPaise: 129900 }])
  })

  it('increases an existing line instead of duplicating it', () => {
    // A cart holding the same variant twice is a cart whose stepper lies.
    const result = addLine([shirt], { variantId: 1, qty: 1, pricePaise: 129900, available: 10 })

    expect(result).toHaveLength(1)
    expect(result[0]?.qty).toBe(3)
  })

  it('matches an existing line across id number and string forms', () => {
    const result = addLine([shirt], { variantId: '1', qty: 1, pricePaise: 129900, available: 10 })

    expect(result).toHaveLength(1)
    expect(result[0]?.qty).toBe(3)
  })

  it('clamps a combined line to what is available', () => {
    const result = addLine([shirt], { variantId: 1, qty: 5, pricePaise: 129900, available: 3 })

    expect(result[0]?.qty).toBe(3)
  })

  it('clamps to the per-line maximum', () => {
    const result = addLine([], { variantId: 1, qty: 99, pricePaise: 129900, available: 500 })

    expect(result[0]?.qty).toBe(MAX_LINE_QTY)
  })

  it('is a no-op when nothing is available', () => {
    expect(addLine([], { variantId: 1, qty: 1, pricePaise: 129900, available: 0 })).toEqual([])
  })

  it('does not change the price already recorded on an existing line', () => {
    const result = addLine([shirt], { variantId: 1, qty: 1, pricePaise: 99900, available: 10 })

    expect(result[0]?.priceAtAddPaise).toBe(129900)
  })

  it('never mutates the input array', () => {
    const items = [shirt]
    addLine(items, { variantId: 1, qty: 1, pricePaise: 129900, available: 10 })

    expect(items[0]?.qty).toBe(2)
  })
})

describe('setLineQty', () => {
  it('sets an exact quantity', () => {
    const result = setLineQty([shirt, jeans], { variantId: 1, qty: 5, available: 10 })

    expect(result[0]?.qty).toBe(5)
    expect(result[1]?.qty).toBe(1)
  })

  it('removes the line at zero', () => {
    // The stepper decrementing below one and the bin icon are then the same operation.
    const result = setLineQty([shirt, jeans], { variantId: 1, qty: 0, available: 10 })

    expect(result).toEqual([jeans])
  })

  it('removes the line for an unusable quantity', () => {
    expect(setLineQty([shirt], { variantId: 1, qty: -1, available: 10 })).toEqual([])
  })

  it('clamps to availability', () => {
    expect(setLineQty([shirt], { variantId: 1, qty: 9, available: 4 })[0]?.qty).toBe(4)
  })

  it('leaves the recorded price alone', () => {
    expect(setLineQty([shirt], { variantId: 1, qty: 5, available: 10 })[0]?.priceAtAddPaise).toBe(129900)
  })

  it('ignores a variant that is not in the cart', () => {
    expect(setLineQty([shirt], { variantId: 99, qty: 3, available: 10 })).toEqual([shirt])
  })
})

describe('removeLine', () => {
  it('drops the matching line', () => {
    expect(removeLine([shirt, jeans], 1)).toEqual([jeans])
  })

  it('matches across id forms', () => {
    expect(removeLine([shirt, jeans], '2')).toEqual([shirt])
  })

  it('is a no-op for an absent variant', () => {
    expect(removeLine([shirt], 99)).toEqual([shirt])
  })
})

describe('reconcileLines', () => {
  it('drops what is no longer sellable', () => {
    const result = reconcileLines([shirt, jeans], (id) => (String(id) === '1' ? 0 : 5))

    expect(result).toEqual([jeans])
  })

  it('clamps a line to what is left', () => {
    const result = reconcileLines([shirt], () => 1)

    expect(result[0]?.qty).toBe(1)
  })

  it('leaves a healthy cart untouched', () => {
    expect(reconcileLines([shirt, jeans], () => 10)).toEqual([shirt, jeans])
  })

  it('respects the per-line maximum even when stock is plentiful', () => {
    const result = reconcileLines([{ variantId: 1, qty: 99, priceAtAddPaise: 100 }], () => 500)

    expect(result[0]?.qty).toBe(MAX_LINE_QTY)
  })
})

describe('findLine and itemCount', () => {
  it('finds by either id form', () => {
    expect(findLine([shirt, jeans], '2')).toEqual(jeans)
    expect(findLine([shirt], 99)).toBeNull()
  })

  it('counts units, not lines', () => {
    expect(itemCount([shirt, jeans])).toBe(3)
    expect(itemCount([])).toBe(0)
  })
})
