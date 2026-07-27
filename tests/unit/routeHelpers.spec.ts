import { describe, expect, it } from 'vitest'

import { readJsonBody, toId, toQty } from '@/lib/http/route'

function post(body: string, contentType = 'application/json'): Request {
  return new Request('https://example.test/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
}

describe('readJsonBody', () => {
  it('returns the object for a well-formed body', async () => {
    await expect(readJsonBody(post('{"action":"add","qty":2}'))).resolves.toEqual({
      action: 'add',
      qty: 2,
    })
  })

  it('returns null rather than throwing on malformed JSON', async () => {
    // The route answers 400. An exception here would reach the error boundary as a 500, which
    // tells a caller that a bad body is a server problem.
    await expect(readJsonBody(post('{not json'))).resolves.toBeNull()
  })

  it('refuses a JSON array', async () => {
    // Arrays are objects to `typeof`, and every caller indexes the result by key.
    await expect(readJsonBody(post('[1,2,3]'))).resolves.toBeNull()
  })

  it('refuses a bare JSON scalar and null', async () => {
    await expect(readJsonBody(post('"add"'))).resolves.toBeNull()
    await expect(readJsonBody(post('42'))).resolves.toBeNull()
    await expect(readJsonBody(post('null'))).resolves.toBeNull()
  })

  it('returns null for an empty body', async () => {
    await expect(readJsonBody(post(''))).resolves.toBeNull()
  })
})

describe('toId', () => {
  it('accepts an integer and a non-empty string', () => {
    expect(toId(7)).toBe(7)
    expect(toId('7')).toBe('7')
  })

  it('trims a string id', () => {
    expect(toId('  7 ')).toBe('7')
  })

  it('rejects everything that is not an id', () => {
    for (const value of [1.5, '', '   ', null, undefined, {}, [], true, NaN]) {
      expect(toId(value)).toBeNull()
    }
  })
})

describe('toQty', () => {
  it('clamps to the maximum rather than refusing', () => {
    // The cart clamps to availability anyway; this stops an absurd number reaching a query.
    expect(toQty(10_000, 10)).toBe(10)
  })

  it('floors a fractional quantity', () => {
    expect(toQty(2.9, 10)).toBe(2)
  })

  it('floors a negative quantity at zero, which the endpoint reads as a removal', () => {
    expect(toQty(-5, 10)).toBe(0)
  })

  it('accepts a numeric string, since a form sends one', () => {
    expect(toQty('3', 10)).toBe(3)
  })

  it('returns null for something that is not a number at all', () => {
    for (const value of ['many', {}, [], undefined, NaN, Infinity]) {
      expect(toQty(value, 10)).toBeNull()
    }
  })

  it('refuses the values `Number()` would silently coerce to zero', () => {
    // The important one. Zero means "remove this line", so a missing or empty `qty` coerced to
    // zero would delete a customer's cart line instead of being answered with a 400.
    for (const value of [null, '', '   ', false]) {
      expect(toQty(value, 10)).toBeNull()
    }
  })
})
