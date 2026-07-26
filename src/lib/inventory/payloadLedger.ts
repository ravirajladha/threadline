/**
 * The Payload-backed implementation of `StockLedgerPort`.
 *
 * One subtlety justifies this file existing rather than the queries being inlined in the hook:
 * **`req` must be threaded through**. A collection hook runs inside the transaction that is
 * creating the movement, and a nested Local API call that does not carry `req` opens its own
 * connection — so it cannot see the uncommitted row, sums a ledger that appears empty, and
 * writes `stockQty: 0` over good data. Passing `req` is the whole difference between a correct
 * stock figure and a silent zero.
 */
import type { Payload, PayloadRequest } from 'payload'

import type { StockLedgerPort } from './syncStock'
import type { StockMovementLike } from './stock'

/**
 * Build the Payload-backed ledger port. `req` is optional: pass it from inside a collection
 * hook so the queries join that hook's transaction, and omit it from a standalone script.
 */
export function createPayloadLedgerPort(payload: Payload, req?: PayloadRequest): StockLedgerPort {
  // Spread-in rather than `req: req ?? undefined` — Payload distinguishes absent from null.
  const transaction = req ? { req } : {}

  return {
    async listMovements(variantId): Promise<StockMovementLike[]> {
      const { docs } = await payload.find({
        collection: 'stockMovements',
        where: { variant: { equals: variantId } },
        depth: 0,
        pagination: false,
        overrideAccess: true,
        ...transaction,
      })

      return docs.map((row) => ({
        type: row.type,
        qty: typeof row.qty === 'number' ? row.qty : 0,
      }))
    },

    async setStockQty(variantId, stockQty): Promise<void> {
      await payload.update({
        collection: 'variants',
        id: variantId,
        data: { stockQty },
        depth: 0,
        overrideAccess: true,
        ...transaction,
      })
    },
  }
}
