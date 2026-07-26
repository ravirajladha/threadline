import { describe, expect, it } from 'vitest'

import { parseCsv, parseCsvRows, toCsv } from '@/lib/csv/csv'

describe('toCsv', () => {
  it('writes a header and one line per row, in the column order given', () => {
    const csv = toCsv([{ sku: 'A-1', qty: 3 }], ['sku', 'qty'])
    expect(csv).toBe('sku,qty\r\nA-1,3\r\n')
  })

  it('respects the declared column order over the object key order', () => {
    const csv = toCsv([{ qty: 3, sku: 'A-1' }], ['sku', 'qty'])
    expect(csv).toBe('sku,qty\r\nA-1,3\r\n')
  })

  it('quotes a field containing the delimiter — the fit-note case', () => {
    const csv = toCsv([{ note: 'Relaxed fit, size down' }], ['note'])
    expect(csv).toBe('note\r\n"Relaxed fit, size down"\r\n')
  })

  it('doubles an embedded quote', () => {
    const csv = toCsv([{ title: 'The 24" Tee' }], ['title'])
    expect(csv).toBe('title\r\n"The 24"" Tee"\r\n')
  })

  it('quotes a field containing a newline', () => {
    const csv = toCsv([{ care: 'Wash cold\nDry flat' }], ['care'])
    expect(csv).toBe('care\r\n"Wash cold\nDry flat"\r\n')
  })

  it('quotes a field with significant leading or trailing space', () => {
    expect(toCsv([{ a: ' padded ' }], ['a'])).toBe('a\r\n" padded "\r\n')
  })

  it('writes null and undefined as empty, not as the words', () => {
    const csv = toCsv([{ a: null, b: undefined }], ['a', 'b'])
    expect(csv).toBe('a,b\r\n,\r\n')
  })

  it('writes zero and false rather than treating them as empty', () => {
    const csv = toCsv([{ qty: 0, active: false }], ['qty', 'active'])
    expect(csv).toBe('qty,active\r\n0,false\r\n')
  })

  it('emits a header-only file for no rows', () => {
    expect(toCsv([], ['sku'])).toBe('sku\r\n')
  })
})

describe('parseCsvRows', () => {
  it('parses plain rows', () => {
    expect(parseCsvRows('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('accepts LF-only line endings', () => {
    expect(parseCsvRows('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps a delimiter inside quotes', () => {
    expect(parseCsvRows('note\r\n"Relaxed fit, size down"\r\n')).toEqual([
      ['note'],
      ['Relaxed fit, size down'],
    ])
  })

  it('unescapes a doubled quote', () => {
    expect(parseCsvRows('title\r\n"The 24"" Tee"\r\n')).toEqual([['title'], ['The 24" Tee']])
  })

  it('keeps a newline inside quotes as one field', () => {
    expect(parseCsvRows('care\r\n"Wash cold\nDry flat"\r\n')).toEqual([
      ['care'],
      ['Wash cold\nDry flat'],
    ])
  })

  it('preserves empty fields', () => {
    expect(parseCsvRows('a,b,c\r\n1,,3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ])
  })

  it('distinguishes an empty quoted field from a missing final row', () => {
    expect(parseCsvRows('a,b\r\n"",\r\n')).toEqual([
      ['a', 'b'],
      ['', ''],
    ])
  })

  it('handles a file with no trailing newline', () => {
    expect(parseCsvRows('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('skips blank lines rather than emitting empty rows', () => {
    expect(parseCsvRows('a\r\n1\r\n\r\n2\r\n')).toEqual([['a'], ['1'], ['2']])
  })

  it('returns nothing for an empty file', () => {
    expect(parseCsvRows('')).toEqual([])
  })
})

describe('parseCsv', () => {
  it('keys each row by the header', () => {
    expect(parseCsv('sku,qty\r\nA-1,3\r\nA-2,5\r\n')).toEqual([
      { sku: 'A-1', qty: '3' },
      { sku: 'A-2', qty: '5' },
    ])
  })

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('returns nothing for a header with no data rows', () => {
    expect(parseCsv('sku,qty\r\n')).toEqual([])
  })

  it('throws on a short row rather than filling the gap', () => {
    // A short row usually means an unescaped delimiter upstream. Guessing here would import a
    // product with the wrong price in it.
    expect(() => parseCsv('sku,price,qty\r\nA-1,49900\r\n')).toThrow(SyntaxError)
  })

  it('throws on a long row', () => {
    expect(() => parseCsv('sku,qty\r\nA-1,3,extra\r\n')).toThrow(SyntaxError)
  })

  it('names the spreadsheet line number in the error', () => {
    // Row 2 of the file, which is what the owner sees in their spreadsheet.
    expect(() => parseCsv('sku,qty\r\nA-1\r\n')).toThrow(/row 2/)
  })
})

describe('round trip', () => {
  it('survives the fields that break naive CSV handling', () => {
    const rows = [
      { sku: 'OXF-NAVY-M', title: 'The 24" Tee', note: 'Relaxed fit, size down', care: 'Wash cold\nDry flat' },
      { sku: 'OXF-NAVY-L', title: 'Plain', note: '', care: ' padded ' },
    ]
    const columns = ['sku', 'title', 'note', 'care'] as const

    expect(parseCsv(toCsv(rows, columns))).toEqual(rows)
  })
})
