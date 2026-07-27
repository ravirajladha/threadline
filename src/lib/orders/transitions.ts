/**
 * The order status machine.
 *
 * An order's status is not a free-text field that anything may set. Statuses arrive from three
 * uncoordinated places — a customer cancelling, staff packing, a courier webhook — and without a
 * machine they overwrite each other: a late "shipped" callback arriving after a delivery reopens
 * a closed order, and a retried webhook moves a refunded order back to paid.
 *
 * So every change goes through `assertTransition`, and an illegal one **throws**. Not a silent
 * no-op: a rejected transition means two systems disagree about reality, and that is worth an
 * error someone reads rather than a status that quietly did not change.
 *
 * The graph is deliberately not a straight line. `shipped → delivered` skips
 * `out_for_delivery` because plenty of couriers never send that scan, and refusing the delivery
 * on those orders would strand them mid-flow.
 */
import type { OrderStatus, PaymentStatus } from '@/types'

/**
 * Legal next statuses for each status.
 *
 * Read as: from the key, an order may only ever move to one of the listed values. An empty list
 * is a terminal state.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = Object.freeze({
  // Awaiting payment. Only three ways out, and two of them are failures.
  pending: ['confirmed', 'cancelled', 'payment_failed'],
  // Paid. Refundable without ever being packed — a same-day cancellation on a paid order.
  confirmed: ['packed', 'cancelled', 'refunded'],
  packed: ['shipped', 'cancelled'],
  // `delivered` is reachable directly: many couriers never send an out-for-delivery scan.
  shipped: ['out_for_delivery', 'delivered', 'rto'],
  out_for_delivery: ['delivered', 'rto'],
  delivered: ['returned'],
  returned: ['refunded'],
  // Return to origin — the parcel came back. Money still has to go back too.
  rto: ['refunded'],
  cancelled: ['refunded'],
  // Terminal. A failed payment starts a new order rather than reviving this one, so the
  // customer's failed attempt stays on the record instead of being edited away.
  payment_failed: [],
  refunded: [],
})

/** Statuses with nowhere left to go. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = Object.freeze(
  (Object.keys(ORDER_TRANSITIONS) as OrderStatus[]).filter(
    (status) => ORDER_TRANSITIONS[status].length === 0,
  ),
)

/** Statuses where the parcel has not left the building, so cancelling is still cheap. */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = Object.freeze([
  'pending',
  'confirmed',
  'packed',
])

export class IllegalTransitionError extends Error {
  readonly from: OrderStatus
  readonly to: OrderStatus

  constructor(from: OrderStatus, to: OrderStatus) {
    super(`An order cannot move from ${from} to ${to}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.to = to
  }
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0
}

/**
 * Whether a transition is legal.
 *
 * A transition to the same status is **not** legal. It looks harmless, but it is how a replayed
 * webhook writes a second `orderEvents` row for an event that already happened, and how a
 * duplicate "delivered" callback fires the delivery notification twice.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to)
}

/** Throws unless the transition is legal. The only sanctioned way to change a status. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to)
}

/** Whether a customer may still cancel — a UI question and a server-side check. */
export function isCancellable(status: OrderStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status)
}

/**
 * Whether stock should be given back at this transition.
 *
 * An order that never shipped returns its units to the shelf. One that came back as an RTO or a
 * return does too, but through the returns flow at J8, where the goods are inspected first —
 * so it is not this function's business.
 */
export function releasesStock(from: OrderStatus, to: OrderStatus): boolean {
  return to === 'cancelled' && CANCELLABLE_STATUSES.includes(from)
}

// --- Payment status ---------------------------------------------------------

/**
 * The payment machine, separate and much smaller.
 *
 * Kept apart from the order status because they genuinely diverge: a delivered order can be
 * `paid` or, for cash on delivery, still `pending` right up to the doorstep.
 */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = Object.freeze({
  pending: ['paid', 'failed'],
  paid: ['refunded'],
  // A retry that succeeds. The gateway is entitled to tell us about it out of order.
  failed: ['paid'],
  refunded: [],
})

export class IllegalPaymentTransitionError extends Error {
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`A payment cannot move from ${from} to ${to}`)
    this.name = 'IllegalPaymentTransitionError'
  }
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to)
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) throw new IllegalPaymentTransitionError(from, to)
}

/**
 * The order status a successful payment implies, or null if the order is past caring.
 *
 * `pending → confirmed` is the normal case. Anything else — already confirmed, already shipped,
 * cancelled — means the webhook is a replay or arrived after a human acted, and the answer is to
 * change nothing rather than to drag the order backwards.
 */
export function statusAfterPayment(current: OrderStatus): OrderStatus | null {
  return current === 'pending' ? 'confirmed' : null
}

/** Likewise for a failed payment. */
export function statusAfterPaymentFailure(current: OrderStatus): OrderStatus | null {
  return current === 'pending' ? 'payment_failed' : null
}
