import { describe, expect, it } from 'vitest'

import { planReceipt, planStockCorrection, planWriteOff } from '@/lib/inventory/adjustment'

describe('planStockCorrection', () => {
  it('adds the difference when the shelf holds more than the system thinks', () => {
    expect(planStockCorrection(10, 14, 'Stock count')).toEqual({
      type: 'adjust',
      qty: 4,
      reason: 'Stock count',
    })
  })

  it('subtracts the difference when the shelf holds less', () => {
    expect(planStockCorrection(10, 6, 'Stock count')).toEqual({
      type: 'adjust',
      qty: -4,
      reason: 'Stock count',
    })
  })

  it('returns null when nothing would change', () => {
    // A zero-quantity row is rejected by the collection and would only add noise to a ledger
    // whose whole value is that every row means something.
    expect(planStockCorrection(10, 10, 'Stock count')).toBeNull()
  })

  it('handles counting down to zero', () => {
    expect(planStockCorrection(3, 0, 'Sold out at the pop-up')).toEqual({
      type: 'adjust',
      qty: -3,
      reason: 'Sold out at the pop-up',
    })
  })

  it('corrects a negative balance back up to a real figure', () => {
    expect(planStockCorrection(-2, 5, 'Reconciled after miscount')?.qty).toBe(7)
  })

  it('trims the reason', () => {
    expect(planStockCorrection(1, 2, '  Late delivery  ')?.reason).toBe('Late delivery')
  })

  it.each([-1, -50])('refuses a negative target of %d', (target) => {
    expect(() => planStockCorrection(10, target, 'Stock count')).toThrow(RangeError)
  })

  it.each([1.5, Number.NaN])('refuses a non-integer target of %j', (target) => {
    expect(() => planStockCorrection(10, target, 'Stock count')).toThrow(RangeError)
  })

  it.each(['', '   '])('refuses a blank reason %j', (reason) => {
    expect(() => planStockCorrection(10, 14, reason)).toThrow(RangeError)
  })
})

describe('planReceipt', () => {
  it('records a delivery as an inbound movement', () => {
    expect(planReceipt(50, 'Supplier delivery #4412')).toEqual({
      type: 'in',
      qty: 50,
      reason: 'Supplier delivery #4412',
    })
  })

  it.each([0, -5, 2.5])('refuses a quantity of %j', (qty) => {
    expect(() => planReceipt(qty, 'Supplier delivery')).toThrow(RangeError)
  })

  it('refuses a blank reason', () => {
    expect(() => planReceipt(50, '  ')).toThrow(RangeError)
  })
})

describe('planWriteOff', () => {
  it('records damage as its own movement type, not as a correction', () => {
    // The distinction matters to whoever reads the ledger later: damage is a loss to account
    // for, a correction is a discrepancy somebody had to explain.
    expect(planWriteOff(2, 'Water damage in transit')).toEqual({
      type: 'damage',
      qty: 2,
      reason: 'Water damage in transit',
    })
  })

  it.each([0, -1])('refuses a quantity of %d', (qty) => {
    expect(() => planWriteOff(qty, 'Damaged')).toThrow(RangeError)
  })
})
