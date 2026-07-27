/**
 * Stock reservation — planned here, applied by the Payload port.
 *
 * A reservation is what stops two shoppers paying for the same last shirt. It is taken **before**
 * payment, released if payment fails or the cart is swept, and converted into a real stock
 * movement when payment succeeds.
 *
 * The three-state model matters, and it is why `reservedQty` exists separately from `stockQty`:
 *
 * - **Reserved** — units held for a checkout in progress. `stockQty` is untouched; the garment
 *   is still physically in the warehouse and nothing has left.
 * - **Committed** — payment succeeded. The reservation is released *and* an `out` movement is
 *   written to the ledger, in the same transaction, so at no instant are the units counted twice
 *   or not at all.
 * - **Released** — payment failed, the customer walked away, or the scheduler swept the cart.
 *   `reservedQty` falls and nothing is written to the ledger, because nothing ever moved.
 *
 * This module is the pure half: it decides what *should* happen and reports shortages. It cannot
 * enforce anything on its own — the concurrency guarantee lives in `payloadReservation.ts`, which
 * re-reads availability *inside* a transaction. A planner that ran outside one would be checking
 * a number that another checkout had already spent.
 */
import { availableToSell } from './stock'

/** What a checkout wants to hold. */
export interface ReservationRequest {
  variantId: number | string
  qty: number
}

/** Live stock for a variant, as the port read it. */
export interface VariantAvailability {
  variantId: number | string
  stockQty: number
  reservedQty: number
}

/** A line that cannot be satisfied, with enough detail to tell the customer why. */
export interface Shortage {
  variantId: number | string
  requested: number
  available: number
}

/** A change to one variant's `reservedQty`. Signed: positive holds, negative frees. */
export interface ReservationDelta {
  variantId: number | string
  reservedDelta: number
}

/** A committed line: the reservation is freed and the same units leave the ledger. */
export interface CommitStep {
  variantId: number | string
  qty: number
  /** Always negative — the reservation is being given up. */
  reservedDelta: number
  /** Units to record as an `out` movement. Positive magnitude; the ledger applies the sign. */
  ledgerQty: number
}

export type ReservationPlan =
  | { ok: true; deltas: ReservationDelta[] }
  | { ok: false; shortages: Shortage[] }

function availabilityMap(availability: readonly VariantAvailability[]): Map<string, VariantAvailability> {
  return new Map(availability.map((entry) => [String(entry.variantId), entry]))
}

/**
 * Plan a reservation, or report everything that blocks it.
 *
 * **All-or-nothing, and every shortage at once.** Partially reserving a five-line order leaves
 * the customer holding stock for an order they cannot place, and reporting only the first
 * shortage turns fixing a cart into a guessing game — the same reason the CSV importer reports
 * every bad row rather than stopping at the first.
 *
 * A variant absent from `availability` is a shortage of zero available, not an exception: a
 * variant deleted between the cart page and the checkout button is a stock problem to show the
 * customer, not a crash.
 */
export function planReservation(
  requests: readonly ReservationRequest[],
  availability: readonly VariantAvailability[],
): ReservationPlan {
  const byVariant = availabilityMap(availability)
  const shortages: Shortage[] = []
  const deltas: ReservationDelta[] = []

  // Requests are folded by variant first: two lines of the same variant must be checked
  // against stock as their sum, or each passes on its own and together they oversell.
  const wanted = new Map<string, { variantId: number | string; qty: number }>()

  for (const request of requests) {
    const key = String(request.variantId)
    const existing = wanted.get(key)

    if (!Number.isInteger(request.qty) || request.qty < 1) {
      throw new RangeError(`Reservation quantity must be a whole number of at least 1, received ${request.qty}`)
    }

    wanted.set(key, {
      variantId: request.variantId,
      qty: (existing?.qty ?? 0) + request.qty,
    })
  }

  for (const [key, request] of wanted) {
    const entry = byVariant.get(key)
    const available = entry === undefined ? 0 : availableToSell(entry.stockQty, entry.reservedQty)

    if (available < request.qty) {
      shortages.push({ variantId: request.variantId, requested: request.qty, available })
      continue
    }

    deltas.push({ variantId: request.variantId, reservedDelta: request.qty })
  }

  if (shortages.length > 0) return { ok: false, shortages }

  return { ok: true, deltas }
}

/**
 * Plan the release of a held reservation.
 *
 * Never reports a shortage — giving units back always succeeds. Clamped so a double release
 * cannot drive `reservedQty` negative, which would otherwise make the variant look like it had
 * *more* available than it physically has.
 */
export function planRelease(
  requests: readonly ReservationRequest[],
  availability: readonly VariantAvailability[],
): ReservationDelta[] {
  const byVariant = availabilityMap(availability)

  return requests
    .map((request) => {
      const held = byVariant.get(String(request.variantId))?.reservedQty ?? 0
      const releasable = Math.min(Math.max(0, request.qty), Math.max(0, held))

      return { variantId: request.variantId, reservedDelta: -releasable }
    })
    .filter((delta) => delta.reservedDelta !== 0)
}

/**
 * Plan the commit of a paid order.
 *
 * Both halves are returned together deliberately: releasing the reservation without writing the
 * ledger row would make sold stock look available again, and writing the ledger row without
 * releasing the reservation would count the same units as gone *and* still held. The port
 * applies both inside one transaction.
 */
export function planCommit(
  requests: readonly ReservationRequest[],
  availability: readonly VariantAvailability[],
): CommitStep[] {
  const byVariant = availabilityMap(availability)

  return requests
    .filter((request) => request.qty > 0)
    .map((request) => {
      const held = byVariant.get(String(request.variantId))?.reservedQty ?? 0
      // Only what is actually held may be released; the units still leave the ledger either
      // way, because they have been paid for and shipped whatever the counter says.
      const release = Math.min(request.qty, Math.max(0, held))

      return {
        variantId: request.variantId,
        qty: request.qty,
        // Guarded against negative zero: `-0` survives JSON as `0` but fails `Object.is`, so
        // it turns an equal delta into a spurious difference in a comparison or a test.
        reservedDelta: release === 0 ? 0 : -release,
        ledgerQty: request.qty,
      }
    })
}

/** Customer-facing copy for a shortage. Says what is possible, not what failed. */
export function shortageMessage(shortage: Shortage, productLabel: string): string {
  if (shortage.available === 0) {
    return `${productLabel} has just sold out.`
  }

  return `Only ${shortage.available} of ${productLabel} left — please reduce the quantity.`
}
