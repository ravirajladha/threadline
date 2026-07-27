/**
 * Applying a reservation, given somewhere to apply it to.
 *
 * `reservation.ts` decides what *should* happen. This file decides what *order* it happens in and
 * what to do when a step refuses — and it does so against an interface, so the awkward cases can
 * be unit tests instead of two browsers racing each other.
 *
 * **Why the planner is not enough.** `planReservation` reads availability and then returns a plan.
 * Between those two moments another checkout can spend the same unit, and both plans come back
 * `ok`. No amount of care in a pure function closes that window, because the window is *between*
 * the read and the write.
 *
 * So the real guarantee lives in `holdOne`, whose contract is deliberately narrow: **atomically**
 * hold `qty` units, or report that it could not. A store backed by SQL satisfies that with a
 * single conditional `UPDATE` — the row is locked for the statement's duration, so the condition
 * is evaluated against state nobody else can be changing. The planner is still run first, because
 * it produces the customer-facing shortage list in one pass rather than discovering problems one
 * failed write at a time; the store is what makes the answer true.
 *
 * **All-or-nothing.** A hold that fails half way puts back what it already took. The caller wraps
 * this in a database transaction as well, so the rollback is belt and braces — but the compensation
 * is written out explicitly here, because a store need not be transactional to be correct, and a
 * reservation that leaked units would quietly make stock disappear with nobody to notice.
 */
import { planReservation, type ReservationRequest, type Shortage, type VariantAvailability } from './reservation'

/**
 * The narrow set of operations a reservation needs from a data store.
 *
 * Small on purpose. Anything wider invites the orchestration below to reach for a shortcut that
 * only one implementation can honour.
 */
export interface ReservationStore {
  /** Live `stockQty` / `reservedQty` for the given variants. Missing variants are simply absent. */
  readAvailability(variantIds: ReadonlyArray<number | string>): Promise<VariantAvailability[]>

  /**
   * Hold `qty` units of one variant, atomically.
   *
   * Returns false when there was not enough to hold. Must never hold a partial quantity: a
   * half-honoured request is indistinguishable from a successful one to the caller, and it is the
   * caller that decides what a shortage means.
   */
  holdOne(variantId: number | string, qty: number): Promise<boolean>

  /** Give units back. Clamped by the implementation so `reservedQty` cannot go negative. */
  releaseOne(variantId: number | string, qty: number): Promise<void>

  /**
   * Record that units have left the building, for an order that has been paid for.
   *
   * Separate from `releaseOne` because the two happen together and mean different things — see
   * `commitReservation`.
   */
  recordSale(variantId: number | string, qty: number, orderId: number | string): Promise<void>
}

export type HoldOutcome = { ok: true } | { ok: false; shortages: Shortage[] }

/**
 * Variants are always touched in a stable order.
 *
 * Two checkouts holding the same two variants in opposite orders is the textbook deadlock: each
 * holds one row and waits for the other. Sorting by variant id means every caller queues for the
 * same rows in the same sequence, so one simply waits and then proceeds.
 */
function inLockOrder(requests: readonly ReservationRequest[]): ReservationRequest[] {
  return [...requests].sort((a, b) => String(a.variantId).localeCompare(String(b.variantId)))
}

/**
 * Fold repeat variants together before anything is held.
 *
 * Two lines of the same variant must be checked against stock as their sum. `planReservation`
 * already does this for the planning pass; the writes need it too, or the second `holdOne` call
 * asks for units the first one has already taken and the totals stop matching the order.
 */
function foldRequests(requests: readonly ReservationRequest[]): ReservationRequest[] {
  const byVariant = new Map<string, ReservationRequest>()

  for (const request of requests) {
    const key = String(request.variantId)
    const existing = byVariant.get(key)

    byVariant.set(key, {
      variantId: request.variantId,
      qty: (existing?.qty ?? 0) + request.qty,
    })
  }

  return [...byVariant.values()]
}

/**
 * Hold stock for a checkout, or report every shortage that blocks it.
 *
 * Two passes, and both earn their place. The **plan** turns "this cart cannot be fulfilled" into a
 * complete list the customer can act on in one go. The **holds** are what actually reserve the
 * units, and one of them can still fail after a clean plan — that is precisely the race the plan
 * cannot see. When it does, the units already taken are put back and the shortage is re-read from
 * the store, so the customer is told what is true *now* rather than what was true a moment ago.
 */
export async function holdReservation(
  store: ReservationStore,
  requests: readonly ReservationRequest[],
): Promise<HoldOutcome> {
  const folded = foldRequests(requests)
  if (folded.length === 0) return { ok: true }

  const availability = await store.readAvailability(folded.map((request) => request.variantId))
  const plan = planReservation(folded, availability)

  if (!plan.ok) return { ok: false, shortages: plan.shortages }

  const held: ReservationRequest[] = []

  for (const request of inLockOrder(folded)) {
    const ok = await store.holdOne(request.variantId, request.qty)

    if (ok) {
      held.push(request)
      continue
    }

    // Lost a race. Undo this attempt entirely before reporting, so a customer who retries is not
    // blocked by units their own abandoned attempt is still holding.
    for (const taken of held) {
      await store.releaseOne(taken.variantId, taken.qty)
    }

    const now = await store.readAvailability([request.variantId])
    const entry = now.find((row) => String(row.variantId) === String(request.variantId))
    const available = entry === undefined ? 0 : Math.max(0, entry.stockQty - entry.reservedQty)

    return {
      ok: false,
      shortages: [{ variantId: request.variantId, requested: request.qty, available }],
    }
  }

  return { ok: true }
}

/**
 * Give a held reservation back.
 *
 * Never fails and never reports a shortage — returning units always succeeds. Called when payment
 * fails, when an order is cancelled before dispatch, and by the scheduler sweeping dead carts.
 */
export async function releaseReservation(
  store: ReservationStore,
  requests: readonly ReservationRequest[],
): Promise<void> {
  for (const request of inLockOrder(foldRequests(requests))) {
    if (request.qty <= 0) continue

    await store.releaseOne(request.variantId, request.qty)
  }
}

/**
 * Convert a reservation into a sale.
 *
 * Both halves, always, and in this order: the units leave the ledger and the hold on them is
 * given up. Doing only the first would count the same units as gone *and* still reserved, making
 * the variant look emptier than it is; doing only the second would put sold stock back on sale.
 * The caller runs this inside a transaction so the pair cannot be interrupted between the two.
 */
export async function commitReservation(
  store: ReservationStore,
  requests: readonly ReservationRequest[],
  orderId: number | string,
): Promise<void> {
  for (const request of inLockOrder(foldRequests(requests))) {
    if (request.qty <= 0) continue

    await store.recordSale(request.variantId, request.qty, orderId)
    await store.releaseOne(request.variantId, request.qty)
  }
}
