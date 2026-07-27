import { describe, expect, it } from 'vitest'

import {
  formatAddress,
  normaliseEmail,
  normalisePhone,
  normalisePincode,
  validateAddress,
} from '@/lib/orders/address'

const valid = {
  name: 'Asha Menon',
  phone: '9876543210',
  line1: '14 Lavelle Road',
  line2: 'Apartment 3B',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  country: 'India',
}

describe('normalisePhone', () => {
  it('accepts the forms customers actually type', () => {
    // Storing whichever form they used makes one customer look like three.
    for (const input of ['9876543210', '+919876543210', '+91 98765 43210', '09876543210', '098765-43210']) {
      expect(normalisePhone(input), input).toBe('9876543210')
    }
  })

  it('rejects anything that is not an Indian mobile number', () => {
    for (const input of ['1234567890', '98765', '98765432100', 'phone', '', null, 5]) {
      expect(normalisePhone(input), String(input)).toBeNull()
    }
  })
})

describe('normalisePincode', () => {
  it('accepts six digits', () => {
    expect(normalisePincode('560 001')).toBe('560001')
  })

  it('rejects a leading zero, which no Indian pincode has', () => {
    expect(normalisePincode('060001')).toBeNull()
  })

  it('rejects the wrong length', () => {
    expect(normalisePincode('56001')).toBeNull()
    expect(normalisePincode('5600011')).toBeNull()
  })
})

describe('validateAddress', () => {
  it('accepts a complete address and cleans it', () => {
    const result = validateAddress({ ...valid, name: '  Asha   Menon ', phone: '+91 98765 43210' })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual({})
    expect(result.address.name).toBe('Asha Menon')
    expect(result.address.phone).toBe('9876543210')
  })

  it('treats line2 as optional', () => {
    const result = validateAddress({ ...valid, line2: '' })

    expect(result.ok).toBe(true)
    expect(result.address.line2).toBeNull()
  })

  it('defaults the country rather than demanding it', () => {
    const result = validateAddress({ ...valid, country: undefined })

    expect(result.address.country).toBe('India')
    expect(result.ok).toBe(true)
  })

  it('reports every problem at once', () => {
    // A form that reveals one problem per submit is the same failure as an importer that
    // stops at the first bad row.
    const result = validateAddress({ name: 'A', phone: '123', line1: '', city: '', state: '', pincode: '00' })

    expect(result.ok).toBe(false)
    expect(Object.keys(result.errors).sort()).toEqual(['city', 'line1', 'name', 'phone', 'pincode', 'state'])
  })

  it('requires the state, because it decides which GST applies', () => {
    expect(validateAddress({ ...valid, state: '' }).errors.state).toBeDefined()
  })

  it('handles a body that is not an object at all', () => {
    for (const input of [null, undefined, 'string', 42, []]) {
      expect(validateAddress(input).ok, String(input)).toBe(false)
    }
  })

  it('returns the cleaned address even when it failed', () => {
    // The form is re-rendered with what the customer typed, tidied, not blanked.
    const result = validateAddress({ ...valid, pincode: 'abc' })

    expect(result.ok).toBe(false)
    expect(result.address.city).toBe('Bengaluru')
    expect(result.address.pincode).toBe('abc')
  })
})

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Asha@Example.COM ')).toBe('asha@example.com')
  })

  it('rejects an obviously malformed address', () => {
    for (const input of ['asha', 'asha@', '@example.com', 'asha@example', 'a b@example.com', null]) {
      expect(normaliseEmail(input), String(input)).toBeNull()
    }
  })
})

describe('formatAddress', () => {
  it('joins the parts that are present', () => {
    expect(formatAddress(valid)).toBe('14 Lavelle Road, Apartment 3B, Bengaluru, Karnataka, 560001, India')
  })

  it('skips an absent line 2 without leaving a double comma', () => {
    expect(formatAddress({ ...valid, line2: null })).toBe('14 Lavelle Road, Bengaluru, Karnataka, 560001, India')
  })
})
