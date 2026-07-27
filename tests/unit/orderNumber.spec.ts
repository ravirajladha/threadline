import { describe, expect, it } from 'vitest'

import { buildOrderNumber, isOrderNumber, parseOrderNumber } from '@/lib/orders/orderNumber'

const july27 = new Date(2026, 6, 27, 14, 30)

describe('buildOrderNumber', () => {
  it('builds a prefix, date and padded sequence', () => {
    expect(buildOrderNumber({ date: july27, sequence: 42 })).toBe('TL-260727-0042')
  })

  it('pads a single-digit sequence', () => {
    expect(buildOrderNumber({ date: july27, sequence: 1 })).toBe('TL-260727-0001')
  })

  it('grows rather than wrapping past four digits', () => {
    // Wrapping would collide with the first order of the same day, which the unique index
    // would then reject at the worst possible moment.
    expect(buildOrderNumber({ date: july27, sequence: 10_000 })).toBe('TL-260727-10000')
  })

  it('zero-pads month and day', () => {
    expect(buildOrderNumber({ date: new Date(2027, 0, 5), sequence: 7 })).toBe('TL-270105-0007')
  })

  it('accepts a different prefix, for a rebrand', () => {
    expect(buildOrderNumber({ date: july27, sequence: 3, prefix: 'ZZ' })).toBe('ZZ-260727-0003')
  })

  it('rejects a sequence that is not a positive whole number', () => {
    expect(() => buildOrderNumber({ date: july27, sequence: 0 })).toThrow(RangeError)
    expect(() => buildOrderNumber({ date: july27, sequence: -1 })).toThrow(RangeError)
    expect(() => buildOrderNumber({ date: july27, sequence: 1.5 })).toThrow(RangeError)
  })

  it('rejects an invalid date', () => {
    expect(() => buildOrderNumber({ date: new Date('nonsense'), sequence: 1 })).toThrow(RangeError)
  })

  it('reveals nothing about lifetime sales volume', () => {
    // The sequence resets daily, so ordering twice does not disclose how much the shop sells.
    const first = buildOrderNumber({ date: new Date(2026, 6, 27), sequence: 1 })
    const later = buildOrderNumber({ date: new Date(2026, 6, 28), sequence: 1 })

    expect(first).not.toBe(later)
    expect(first.endsWith('0001')).toBe(true)
    expect(later.endsWith('0001')).toBe(true)
  })
})

describe('parseOrderNumber', () => {
  it('round-trips what it builds', () => {
    const number = buildOrderNumber({ date: july27, sequence: 42 })

    expect(parseOrderNumber(number)).toEqual({ prefix: 'TL', datePart: '260727', sequence: 42 })
  })

  it('survives what a customer actually types', () => {
    // Support pastes these into a search box.
    expect(parseOrderNumber('  tl-260727-0042 ')?.sequence).toBe(42)
  })

  it('returns null for a typo rather than throwing', () => {
    for (const value of ['', 'TL-2607-0042', 'TL260727 0042', 'hello', '260727-0042']) {
      expect(parseOrderNumber(value), value).toBeNull()
    }
  })

  it('recognises one of ours', () => {
    expect(isOrderNumber('TL-260727-0042')).toBe(true)
    expect(isOrderNumber('42')).toBe(false)
  })
})
