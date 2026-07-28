/**
 * Human-quotable references — order numbers, ticket numbers, and whatever comes next.
 *
 * `TL-260727-0042` is the forty-second order of 27 July 2026; `TS-260727-0007` is that day's
 * seventh support request. One shape, one parser, one set of rules, because the second use of this
 * pattern is where a copy would start drifting (CLAUDE.md §3).
 *
 * The properties that matter, and why:
 *
 * - **Not the database id.** A sequential public id tells anyone who orders twice exactly how much
 *   the shop sells, and it invites walking the numbers to see whether somebody else's looks up.
 * - **No personal information**, so it is safe in a URL, an email subject and a log line.
 * - **The date prefix resets the sequence daily**, which keeps the number short to read aloud
 *   without ever implying a lifetime total.
 * - **A reference is an identifier, never an authorisation.** Nothing anywhere may treat holding
 *   one as permission to read the thing it names — that is enforced at the access layer, and it is
 *   why `parseReference` demands the expected prefix rather than accepting any.
 *
 * The sequence is supplied by the caller, which reads it from the database. Two writes in the same
 * millisecond can compute the same reference; that collision is caught by the unique constraint on
 * the column and retried by the port. Guarding against it here would mean this module owning a
 * database connection, which is exactly what keeps it testable to not do.
 */

/** `YYMMDD` in the shop's own local date — the date the customer will say out loud. */
function datePart(date: Date): string {
  const year = String(date.getFullYear() % 100).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}${month}${day}`
}

/**
 * Build a reference.
 *
 * The sequence is padded to four digits and then allowed to grow: a 10,000th order in one day
 * produces a longer number rather than wrapping round and colliding with the first.
 */
export function buildReference(input: { date: Date; sequence: number; prefix: string }): string {
  const { date, sequence, prefix } = input

  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`A reference sequence must be a whole number of at least 1, received ${sequence}`)
  }
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('A reference requires a valid date')
  }

  return `${prefix}-${datePart(date)}-${String(sequence).padStart(4, '0')}`
}

export interface ParsedReference {
  prefix: string
  datePart: string
  sequence: number
}

/**
 * Parse a reference back out, insisting on the prefix it should have.
 *
 * Support types one of these into a search box, so it has to survive lower case and stray
 * whitespace. Returns null rather than throwing — an unparseable reference is a customer typo,
 * which is a "we could not find that" message, not an error.
 *
 * **The prefix is checked, not merely captured.** Accepting any two-to-six letters would make a
 * ticket number parse as a valid order number and vice versa, so a support search for `TS-…` would
 * go looking through orders and find nothing, with no clue why.
 */
export function parseReference(value: string, expectedPrefix: string): ParsedReference | null {
  const match = /^([A-Z]{2,6})-(\d{6})-(\d{4,})$/.exec(value.trim().toUpperCase())
  if (match === null) return null

  const [, prefix, date, sequence] = match
  if (prefix === undefined || date === undefined || sequence === undefined) return null
  if (prefix !== expectedPrefix.toUpperCase()) return null

  return { prefix, datePart: date, sequence: Number(sequence) }
}

/**
 * The date-and-dash portion, for a `like` query that counts the day's references so far.
 *
 * Derived from a real reference rather than formatted a second time, so the prefix used to count
 * cannot drift from the prefix used to build.
 */
export function datePrefixOf(reference: string): string {
  return reference.slice(0, reference.lastIndexOf('-') + 1)
}
