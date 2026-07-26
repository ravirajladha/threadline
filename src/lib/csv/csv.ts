/**
 * CSV serialise and parse, to RFC 4180.
 *
 * Written rather than depended on because the requirement is small and the failure mode is
 * expensive: a naive `split(',')` corrupts exactly the rows a clothing catalog is full of —
 * `"Relaxed fit, size down"` in a fit note, a product title with a quote in it, an address
 * with a newline. Those rows are also the ones nobody notices are broken until an import has
 * already run.
 *
 * Deliberately dumb about meaning: everything here is strings. Turning a row into a product is
 * `./catalogCsv.ts`'s job, and keeping the two apart is what makes both testable.
 */

const QUOTE = '"'
const DELIMITER = ','

/** Quote a field only when it needs it, so a hand-edited export stays readable. */
function encodeField(value: string): string {
  const needsQuoting =
    value.includes(DELIMITER) ||
    value.includes(QUOTE) ||
    value.includes('\n') ||
    value.includes('\r') ||
    value !== value.trim()

  if (!needsQuoting) return value

  return `${QUOTE}${value.split(QUOTE).join(QUOTE + QUOTE)}${QUOTE}`
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Serialise `rows` under `columns`, in the order given.
 *
 * `columns` is explicit rather than inferred from the first row: an export whose column set
 * depends on whichever product happened to sort first is not a stable file format, and the
 * import on the other end has to be able to rely on it.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly (keyof T & string)[],
): string {
  const header = columns.map(encodeField).join(DELIMITER)
  const body = rows.map((row) => columns.map((column) => encodeField(stringify(row[column]))).join(DELIMITER))

  // Trailing newline: POSIX tools and most spreadsheets expect a file to end with one.
  return [header, ...body].join('\r\n') + '\r\n'
}

/**
 * Parse `text` into rows of raw fields.
 *
 * A hand-written state machine rather than a regex, because quoted fields can contain the
 * delimiter, the quote character (doubled) and line breaks — which a regex cannot track
 * without becoming unreadable.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false

  const endField = (): void => {
    row.push(field)
    field = ''
    fieldWasQuoted = false
  }

  const endRow = (): void => {
    endField()
    // A blank line is not a row of one empty field — it is nothing.
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inQuotes) {
      if (char === QUOTE) {
        if (text[index + 1] === QUOTE) {
          field += QUOTE
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === QUOTE && field === '') {
      inQuotes = true
      fieldWasQuoted = true
      continue
    }

    if (char === DELIMITER) {
      endField()
      continue
    }

    if (char === '\r') {
      // Consume CRLF as one line ending.
      if (text[index + 1] === '\n') index += 1
      endRow()
      continue
    }

    if (char === '\n') {
      endRow()
      continue
    }

    field += char
  }

  // Whatever is left is the last row, unless the file ended on a line break.
  if (field !== '' || fieldWasQuoted || row.length > 0) endRow()

  return rows
}

/**
 * Parse `text` into objects keyed by the header row.
 *
 * Throws on a row whose field count does not match the header. A short row usually means an
 * unescaped delimiter upstream, and silently filling the gap with empty strings would import
 * a product with the wrong price in it.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseCsvRows(text)
  const header = rows[0]
  if (!header) return []

  return rows.slice(1).map((row, index) => {
    if (row.length !== header.length) {
      throw new SyntaxError(
        `CSV row ${index + 2} has ${row.length} fields but the header has ${header.length}.`,
      )
    }

    const record: Record<string, string> = {}
    header.forEach((column, position) => {
      record[column] = row[position] ?? ''
    })

    return record
  })
}
