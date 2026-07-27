/**
 * Raw SQL access, for the few places the Local API cannot express what is needed.
 *
 * Dropping below Payload is a deliberate exception and there are only two reasons for it in this
 * project, both of them concurrency:
 *
 * - **Conditional update** — `inventory/payloadReservation.ts` makes "is there enough?" and "take
 *   it" one statement, so there is no window between them to oversell in.
 * - **Row locking** — `orders/payloadOrders.ts` takes `SELECT … FOR UPDATE` before it reads the
 *   state it is about to decide on, so two concurrent webhook deliveries cannot both read "not yet
 *   applied" and both apply.
 *
 * Neither is expressible through `find`/`update`, because both are about what happens *between*
 * two Local API calls. Everything else in the project stays on the Local API.
 *
 * On SQL injection (OWASP A03): callers build statements with drizzle's `sql` template, which
 * binds every interpolation as a parameter. No caller may concatenate a string into a query, and
 * the reviewable rule is simple — a `sql` template with no `${}` in it needs no parameters, and
 * one with `${}` gets them bound. There is no third case.
 */
import type { Payload } from 'payload'

/** The slice of a drizzle client this project uses. */
export interface DrizzleLike {
  execute(query: unknown): Promise<unknown>
}

interface DrizzleAdapterLike {
  drizzle: DrizzleLike
  sessions: Record<string, { db: DrizzleLike } | undefined>
}

/**
 * The drizzle client for an open Payload transaction, or the pooled one when there is none.
 *
 * Payload keeps one session per transaction id. Using the wrong client would run the statement on
 * a *different* connection — outside the transaction, where it would neither see the caller's
 * uncommitted work nor be rolled back with it, and where a `FOR UPDATE` lock would be released the
 * instant the statement ended rather than held to the end of the transaction.
 *
 * Falling back to the pooled client is correct for a single atomic statement, which needs no
 * transaction to be atomic. It is **not** correct for a lock, so `lockRow` below is explicit that
 * it only guarantees anything inside a transaction.
 */
export function drizzleClientFor(
  payload: Payload,
  transactionID: string | number | null,
): DrizzleLike {
  const adapter = payload.db as unknown as DrizzleAdapterLike

  if (transactionID !== null) {
    const session = adapter.sessions?.[String(transactionID)]
    if (session !== undefined) return session.db
  }

  return adapter.drizzle
}

/**
 * How many rows a statement changed, across the shapes drizzle's adapters return.
 *
 * node-postgres reports `rowCount`; some drivers return an array of the affected rows instead.
 * For a conditional update this is the difference between "held" and "sold out", so it is read
 * defensively rather than assumed — a wrong answer here silently oversells.
 */
export function rowsAffected(result: unknown): number {
  if (Array.isArray(result)) return result.length

  if (typeof result === 'object' && result !== null) {
    const row = result as { rowCount?: unknown; rows?: unknown }

    if (typeof row.rowCount === 'number') return row.rowCount
    if (Array.isArray(row.rows)) return row.rows.length
  }

  return 0
}

/** Rows from a `SELECT`, across the same driver differences. */
export function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>

  if (typeof result === 'object' && result !== null) {
    const rows = (result as { rows?: unknown }).rows
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>
  }

  return []
}

/** A count column as a number, whatever the driver made of it. */
export function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)

  // Postgres returns bigint-ish columns as strings through some drivers.
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)

    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}
