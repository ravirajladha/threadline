/**
 * Running work inside one database transaction.
 *
 * Payload exposes transactions as three calls that must be paired correctly — begin, then exactly
 * one of commit or rollback, on every path including the ones that throw. Written out at each call
 * site that is three chances to leak a connection, so it is written out once here.
 *
 * `beginTransaction` returns `null` when the adapter does not support transactions. That is not an
 * error: the callback still runs, just without the guarantee. Handling it here means the ports
 * above do not each need a branch for it.
 */
import type { Payload, PayloadRequest } from 'payload'

/**
 * The slice of `PayloadRequest` a nested Local API call needs to join an open transaction.
 *
 * Payload's own signatures want the full request, but only the transaction id is ever read on this
 * path. Casting once, here, with a name that says why, is honest about it — and keeps the cast out
 * of the ports, where an unexplained `as PayloadRequest` would look like carelessness.
 */
export type TransactionReq = Pick<PayloadRequest, 'transactionID'>

export function transactionReq(transactionID: string | number | null): { req?: PayloadRequest } {
  if (transactionID === null) return {}

  return { req: { transactionID } as PayloadRequest }
}

/**
 * Run `work` in a transaction, committing on success and rolling back on any throw.
 *
 * The callback receives the transaction id so it can thread it into Local API calls. A nested call
 * that does *not* carry it opens its own connection and cannot see the uncommitted rows — the same
 * trap documented in `payloadLedger.ts`, and the reason stock once wrote itself to zero.
 */
export async function withTransaction<T>(
  payload: Payload,
  work: (transactionID: string | number | null) => Promise<T>,
): Promise<T> {
  const transactionID = (await payload.db.beginTransaction?.()) ?? null

  if (transactionID === null) return work(null)

  try {
    const result = await work(transactionID)
    await payload.db.commitTransaction?.(transactionID)

    return result
  } catch (error) {
    await payload.db.rollbackTransaction?.(transactionID)
    throw error
  }
}
