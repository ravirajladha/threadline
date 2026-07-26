/**
 * Reconciling a variant's cached `stockQty` with its ledger.
 *
 * The maths is in `./stock.ts` and stays pure. This module is the thin seam between that maths
 * and whatever actually stores the rows, expressed as an interface so the caller supplies the
 * storage — the collection hook passes a Payload-backed port, the seed script passes the same
 * one, and a test passes an in-memory object. That is the "program to interfaces" rule in
 * CLAUDE.md §3 applied to the one place inventory touches the database.
 */
import { stockOnHand, type StockMovementLike } from './stock'

export interface StockLedgerPort {
  /** Every movement for one variant. Must include rows written in the current transaction. */
  listMovements(variantId: number | string): Promise<StockMovementLike[]>
  setStockQty(variantId: number | string, stockQty: number): Promise<void>
}

/**
 * Recompute `stockQty` from the whole ledger and store it. Returns the new figure.
 *
 * Recomputing rather than incrementing costs one extra read and buys correctness: the cached
 * number can never drift from the rows that justify it, so a discrepancy is always explainable
 * and a fix is another movement rather than a hand-edited total.
 */
export async function syncVariantStock(
  port: StockLedgerPort,
  variantId: number | string,
): Promise<number> {
  const movements = await port.listMovements(variantId)
  const stockQty = stockOnHand(movements)

  await port.setStockQty(variantId, stockQty)

  return stockQty
}
