/**
 * Crossing from the domain's id type to Payload's.
 *
 * The domain layers type an id as `number | string`, deliberately: `Money`, the cart and the
 * reservation planner know nothing about which database is underneath, and pinning them to
 * Postgres' integer keys would be a detail leaking upwards into pure, tested code.
 *
 * Payload's generated types are narrower — this project's collections use numeric keys — so every
 * write has to narrow back down. The tempting fix is `id as number`, and that is exactly what this
 * module exists to avoid: a cast asserts the narrowing is safe without checking, so the day an id
 * arrives as a string from a query parameter, the cast passes it straight through to the driver and
 * the failure surfaces as an opaque database error rather than a clear one here.
 */

export class InvalidIdError extends Error {
  constructor(value: unknown) {
    super(`Expected a numeric record id, received ${typeof value === 'string' ? `"${value}"` : String(value)}`)
    this.name = 'InvalidIdError'
  }
}

/**
 * Narrow a domain id to the numeric key Payload expects.
 *
 * A numeric string is accepted and converted — ids arrive that way from URLs and JSON bodies, and
 * refusing them would mean every caller parsing before it calls. Anything else throws, because
 * there is no correct value to substitute: guessing would write the wrong row.
 */
export function numericId(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new InvalidIdError(value)

    return value
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || value.trim() === '') throw new InvalidIdError(value)

  return parsed
}

/** The same narrowing where absence is legitimate — an optional relationship. */
export function optionalNumericId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null

  return numericId(value)
}

/**
 * The id of a relationship field, however Payload chose to hand it over.
 *
 * Payload types every relationship as `id | Doc` regardless of the `depth` asked for, because
 * depth is a runtime argument and the generated types cannot narrow on it. So even a `depth: 0`
 * read — which returns bare ids in practice — is typed as the union, and every call site has to
 * unwrap it.
 *
 * That unwrap was written out by hand in four separate files before this existed. It is one line,
 * which is exactly why it spreads, and exactly why the fifth copy would eventually be the one
 * that forgot the `null` case.
 */
export function relationshipId(value: unknown): number | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'object') {
    const id: unknown = (value as { id?: unknown }).id

    return typeof id === 'number' || typeof id === 'string' ? optionalNumericId(id) : null
  }

  return typeof value === 'number' || typeof value === 'string' ? optionalNumericId(value) : null
}
