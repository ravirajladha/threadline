/**
 * Order numbers.
 *
 * The reference a customer reads down the phone, so it is short, unambiguous when spoken, and
 * carries no personal information. `TL-260727-0042` is the forty-second order of 27 July 2026.
 *
 * Deliberately **not** the database id. A sequential public id tells anyone who orders twice
 * exactly how much the shop sells, and it invites walking the numbers to see whether somebody
 * else's order looks up. The date prefix keeps the daily sequence small and resets it, so the
 * number stays short without ever suggesting a lifetime total.
 *
 * The sequence is supplied by the caller, which reads it from the database. Two checkouts in the
 * same millisecond can therefore compute the same number — that collision is caught by the
 * unique constraint on `orders.orderNumber` and retried by the port. Guarding against it here
 * would mean this module owning a database connection, which is exactly what keeps it testable
 * to not do.
 */

export const ORDER_NUMBER_PREFIX = 'TL'

/** `YYMMDD` in the shop's own local date — the date the customer will say out loud. */
function datePart(date: Date): string {
  const year = String(date.getFullYear() % 100).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}${month}${day}`
}

/**
 * Build an order number.
 *
 * The sequence is padded to four digits and then allowed to grow: a 10,000th order in one day
 * produces a longer number rather than wrapping round and colliding with the first.
 */
export function buildOrderNumber(input: { date: Date; sequence: number; prefix?: string }): string {
  const { date, sequence, prefix = ORDER_NUMBER_PREFIX } = input

  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Order sequence must be a whole number of at least 1, received ${sequence}`)
  }
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Order number requires a valid date')
  }

  return `${prefix}-${datePart(date)}-${String(sequence).padStart(4, '0')}`
}

export interface ParsedOrderNumber {
  prefix: string
  datePart: string
  sequence: number
}

/**
 * Parse an order number back out.
 *
 * Support types one of these into a search box, so it has to survive lower case and stray
 * whitespace. Returns null rather than throwing — an unparseable reference is a customer typo,
 * which is a "we could not find that order" message, not an error.
 */
export function parseOrderNumber(value: string): ParsedOrderNumber | null {
  const match = /^([A-Z]{2,6})-(\d{6})-(\d{4,})$/.exec(value.trim().toUpperCase())
  if (match === null) return null

  const [, prefix, date, sequence] = match
  if (prefix === undefined || date === undefined || sequence === undefined) return null

  return { prefix, datePart: date, sequence: Number(sequence) }
}

/** Whether a string looks like one of ours. Used to route a support search. */
export function isOrderNumber(value: string): boolean {
  return parseOrderNumber(value) !== null
}
