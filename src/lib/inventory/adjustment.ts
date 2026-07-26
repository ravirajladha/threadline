/**
 * Turning what an owner means into a ledger movement.
 *
 * The owner thinks "there are 12 of these on the shelf". The ledger stores "+20, −9, +1". This
 * module is the translation, and it exists so that the admin can offer a plain "set stock to N"
 * box without anyone being tempted to make `stockQty` writable — which would put the cached
 * figure and its ledger permanently out of step.
 *
 * Every function returns a movement to append, never an edit. That is the whole discipline:
 * stock only ever moves by adding a row.
 */
import type { StockMovementType } from '@/types'

export interface PlannedMovement {
  type: StockMovementType
  /** Signed for `adjust`; positive magnitude for the directional types. */
  qty: number
  reason: string
}

/**
 * The movement that takes stock from `currentQty` to `targetQty`.
 *
 * Returns `null` when nothing would change — the caller shows "no change" rather than writing
 * a zero-quantity row, which the collection rejects anyway and which would only add noise to
 * an audit trail whose value is that every row means something.
 */
export function planStockCorrection(
  currentQty: number,
  targetQty: number,
  reason: string,
): PlannedMovement | null {
  if (!Number.isInteger(targetQty)) {
    throw new RangeError(`Stock must be a whole number of units, received ${targetQty}`)
  }
  if (targetQty < 0) {
    throw new RangeError('Stock cannot be set to a negative number.')
  }
  if (reason.trim().length === 0) {
    throw new RangeError('A stock correction needs a reason — it is the point of the ledger.')
  }

  const delta = targetQty - currentQty
  if (delta === 0) return null

  return { type: 'adjust', qty: delta, reason: reason.trim() }
}

/**
 * Stock arriving — a supplier delivery. Separate from a correction because the two mean
 * different things to whoever reads the ledger later: a receipt is expected, a correction is
 * a discrepancy somebody had to explain.
 */
export function planReceipt(qty: number, reason: string): PlannedMovement {
  return directional('in', qty, reason, 'received')
}

/** Stock written off — damaged, unsellable. Never silently deducted as a correction. */
export function planWriteOff(qty: number, reason: string): PlannedMovement {
  return directional('damage', qty, reason, 'written off')
}

function directional(
  type: StockMovementType,
  qty: number,
  reason: string,
  verb: string,
): PlannedMovement {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new RangeError(`Units ${verb} must be a whole number above zero, received ${qty}`)
  }
  if (reason.trim().length === 0) {
    throw new RangeError(`A movement needs a reason — say why units were ${verb}.`)
  }

  return { type, qty, reason: reason.trim() }
}
