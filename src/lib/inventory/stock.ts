/**
 * Stock arithmetic over the append-only movement ledger.
 *
 * `variants.stockQty` is never authored — it is the sum of that variant's `stockMovements`.
 * Keeping the ledger as the source of truth means every unit is accounted for: a stock
 * discrepancy is always traceable to a row, and a rollback is another row rather than an
 * edit. These functions are pure so the same maths runs in hooks, in the admin and in tests.
 */
import type { StockMovementType } from '@/types'

/** The minimum a caller must supply to be counted — matches `stockMovements`. */
export interface StockMovementLike {
  type: StockMovementType
  /** Signed quantity. Negative for units leaving; see `signedQty`. */
  qty: number
}

/** Movement types that always remove units, whatever sign the author supplied. */
const OUTBOUND_TYPES: readonly StockMovementType[] = ['out', 'damage']
/** Movement types that always add units. */
const INBOUND_TYPES: readonly StockMovementType[] = ['in', 'return']

/**
 * The signed contribution of one movement.
 *
 * `out` and `damage` always subtract and `in` and `return` always add, so a hook that
 * receives a careless sign still moves stock the right way. `adjust` is the one type that
 * trusts its sign — that is exactly what a stock-count correction is for.
 */
export function signedQty(movement: StockMovementLike): number {
  const magnitude = Math.abs(movement.qty)
  if (OUTBOUND_TYPES.includes(movement.type)) return -magnitude
  if (INBOUND_TYPES.includes(movement.type)) return magnitude
  return movement.qty
}

/** Current stock for a variant: the sum of its whole ledger. */
export function stockOnHand(movements: readonly StockMovementLike[]): number {
  return movements.reduce((total, movement) => total + signedQty(movement), 0)
}

/**
 * Units a customer may actually add to a cart.
 *
 * Reserved units belong to checkouts already in progress. Never returns a negative number:
 * an over-reservation is a bug to investigate, not a reason to show "-2 left".
 */
export function availableToSell(stockQty: number, reservedQty: number): number {
  return Math.max(0, stockQty - reservedQty)
}

/** Whether `qty` units can be sold right now. */
export function canFulfil(stockQty: number, reservedQty: number, qty: number): boolean {
  return qty > 0 && availableToSell(stockQty, reservedQty) >= qty
}
