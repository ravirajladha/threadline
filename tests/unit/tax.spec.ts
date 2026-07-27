import { describe, expect, it } from 'vitest'

import { Money } from '@/lib/pricing/money'
import {
  addBreakups,
  breakupTotal,
  emptyBreakup,
  normaliseState,
  splitTax,
  taxJurisdiction,
  taxOn,
} from '@/lib/pricing/tax'

describe('taxJurisdiction', () => {
  it('is intra-state when the destination matches the seller', () => {
    expect(taxJurisdiction('Karnataka', 'Karnataka')).toBe('intra_state')
  })

  it('is inter-state for any other destination', () => {
    expect(taxJurisdiction('Karnataka', 'Maharashtra')).toBe('inter_state')
  })

  it('ignores case and surrounding whitespace', () => {
    expect(taxJurisdiction('Karnataka', '  karnataka ')).toBe('intra_state')
    expect(taxJurisdiction('  Tamil  Nadu', 'tamil nadu')).toBe('intra_state')
  })

  it('treats a missing destination as the seller’s own state', () => {
    // The cart page has no address yet. Defaulting to intra-state never invents an
    // inter-state sale out of absent data.
    expect(taxJurisdiction('Karnataka', null)).toBe('intra_state')
    expect(taxJurisdiction('Karnataka', '   ')).toBe('intra_state')
  })
})

describe('normaliseState', () => {
  it('collapses internal whitespace', () => {
    expect(normaliseState(' Jammu   and  Kashmir ')).toBe('jammu and kashmir')
  })
})

describe('taxOn', () => {
  it('applies a whole percentage rate', () => {
    expect(taxOn(Money.fromPaise(100000), 5).toPaise()).toBe(5000)
    expect(taxOn(Money.fromPaise(100000), 12).toPaise()).toBe(12000)
  })

  it('rounds to the nearest paise', () => {
    // 5% of 99,999 paise is 4,999.95
    expect(taxOn(Money.fromPaise(99999), 5).toPaise()).toBe(5000)
  })

  it('is zero at a zero rate', () => {
    expect(taxOn(Money.fromPaise(129900), 0).isZero()).toBe(true)
  })

  it('rejects a negative or non-finite rate', () => {
    expect(() => taxOn(Money.fromPaise(100), -5)).toThrow(RangeError)
    expect(() => taxOn(Money.fromPaise(100), Number.NaN)).toThrow(RangeError)
  })
})

describe('splitTax', () => {
  it('splits an even amount into equal halves', () => {
    const breakup = splitTax(Money.fromPaise(5000), 'intra_state')

    expect(breakup.cgst.toPaise()).toBe(2500)
    expect(breakup.sgst.toPaise()).toBe(2500)
    expect(breakup.igst.toPaise()).toBe(0)
  })

  it('puts the whole amount in IGST across states, and never splits it', () => {
    const breakup = splitTax(Money.fromPaise(5000), 'inter_state')

    expect(breakup.igst.toPaise()).toBe(5000)
    expect(breakup.cgst.isZero()).toBe(true)
    expect(breakup.sgst.isZero()).toBe(true)
  })

  it('never gains or loses a paise on an odd amount', () => {
    // The defect this guards: two independent 50% roundings of 4,999 paise both give 2,500
    // and sum to 5,000 — one paise more tax than was charged.
    const tax = Money.fromPaise(4999)
    const breakup = splitTax(tax, 'intra_state')

    expect(breakup.cgst.toPaise()).toBe(2499)
    expect(breakup.sgst.toPaise()).toBe(2500)
    expect(breakupTotal(breakup).equals(tax)).toBe(true)
  })

  it('reconciles for every amount across a paise range', () => {
    for (let paise = 0; paise <= 250; paise += 1) {
      const tax = Money.fromPaise(paise)

      expect(breakupTotal(splitTax(tax, 'intra_state')).toPaise()).toBe(paise)
      expect(breakupTotal(splitTax(tax, 'inter_state')).toPaise()).toBe(paise)
    }
  })

  it('splits zero into zeros', () => {
    expect(breakupTotal(splitTax(Money.zero(), 'intra_state')).isZero()).toBe(true)
  })
})

describe('addBreakups', () => {
  it('accumulates line by line', () => {
    const total = addBreakups(
      splitTax(Money.fromPaise(4999), 'intra_state'),
      splitTax(Money.fromPaise(4999), 'intra_state'),
    )

    expect(total.cgst.toPaise()).toBe(4998)
    expect(total.sgst.toPaise()).toBe(5000)
    expect(breakupTotal(total).toPaise()).toBe(9998)
  })

  it('starts from an empty breakup without changing the result', () => {
    const one = splitTax(Money.fromPaise(1234), 'inter_state')

    expect(breakupTotal(addBreakups(emptyBreakup(), one)).toPaise()).toBe(1234)
  })
})
