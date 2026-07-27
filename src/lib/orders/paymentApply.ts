/**
 * Deciding what a payment event does to an order.
 *
 * A webhook handler that reasons about this inline ends up with the two classic defects, both of
 * which cost real money:
 *
 * **Double processing.** Providers retry — a slow response, a deploy mid-request, and the same
 * event arrives again. Without an idempotency key the order is confirmed twice, the stock is
 * committed twice and the confirmation email goes out twice. So every event carries a provider id,
 * and an id already recorded against the order is a no-op (OWASP A08).
 *
 * **Trusting the amount.** The event says what was paid. If nothing compares that with what the
 * order costs, an order can be confirmed by a payment for ₹1 — and since the gateway *did* take
 * ₹1, no reconciliation catches it either. A mismatch is refused and logged, never rounded past.
 *
 * Pure and total: every combination of order state and event type maps to exactly one decision,
 * so the awkward orderings — a capture after a cancellation, a failure after a capture, a refund
 * on an unpaid order — are table-driven tests instead of production surprises.
 */
import type { OrderStatus, PaymentStatus } from '@/types'
import type { PaymentEvent } from '@/lib/payments/types'
import { eventIdsFrom, PAYMENT_EVENT_ID_PREFIXES } from './eventTrail'
import { canTransition, canTransitionPayment, statusAfterPayment, statusAfterPaymentFailure } from './transitions'

/** The order as the webhook handler read it. */
export interface OrderPaymentState {
  orderNumber: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  /** What the order actually costs, in paise. The authority the event is checked against. */
  grandTotal: number
  /**
   * Provider event ids already applied to this order.
   *
   * Read from the append-only `orderEvents` trail rather than a separate table: the audit log is
   * already the record of what happened, and a second store would be a second thing to keep in
   * step with it.
   */
  processedEventIds: readonly string[]
}

export const PAYMENT_IGNORE_REASONS = [
  'duplicate_event',
  'amount_mismatch',
  'reference_mismatch',
  'order_not_pending',
  'already_paid',
  'not_refundable',
  'unsupported_event',
] as const
export type PaymentIgnoreReason = (typeof PAYMENT_IGNORE_REASONS)[number]

export type PaymentApplyDecision =
  | {
      action: 'apply'
      toStatus: OrderStatus
      toPaymentStatus: PaymentStatus
      /** Short, PII-free note for the `orderEvents` row. Carries the event id for the next replay. */
      note: string
    }
  | { action: 'ignore'; reason: PaymentIgnoreReason }

/**
 * The `orderEvents.note` an applied event writes.
 *
 * The event id has to survive in the audit trail, because that trail is what the next replay of
 * the same event is checked against. Nothing else goes in — no amount, no payment id beyond the
 * provider's own handle, and never a customer detail (OWASP A09).
 */
export function eventNote(event: PaymentEvent): string {
  return `${event.type} ${event.id}`
}

/**
 * Recover the **payment** event ids recorded in an order's audit trail.
 *
 * A thin wrapper over `eventTrail.eventIdsFrom` bound to the payment prefixes. Kept as its own name
 * because a caller that means "payment ids" should not have to pass a prefix list and get it wrong —
 * asking for payment ids and receiving tracking ids too would make an unrelated delivery scan look
 * like a duplicate capture.
 */
export function processedEventIdsFrom(notes: readonly (string | null | undefined)[]): string[] {
  return eventIdsFrom(notes, PAYMENT_EVENT_ID_PREFIXES)
}

function ignore(reason: PaymentIgnoreReason): PaymentApplyDecision {
  return { action: 'ignore', reason }
}

/**
 * What this event should do to this order.
 *
 * Order of the checks is the security order: identity of the order, then whether we have already
 * seen the event, then whether the money is right, and only then what the order's state allows.
 */
export function decidePaymentApply(input: {
  order: OrderPaymentState
  event: PaymentEvent
}): PaymentApplyDecision {
  const { order, event } = input

  if (event.reference !== order.orderNumber) return ignore('reference_mismatch')
  if (order.processedEventIds.includes(event.id)) return ignore('duplicate_event')

  if (event.type === 'payment.captured') {
    // Never confirm an order for less — or more — than it costs. The gateway really did take
    // this amount, so no later reconciliation would catch the difference.
    if (event.amountPaise !== order.grandTotal) return ignore('amount_mismatch')
    if (order.paymentStatus === 'paid') return ignore('already_paid')
    if (!canTransitionPayment(order.paymentStatus, 'paid')) return ignore('already_paid')

    const toStatus = statusAfterPayment(order.status)
    // A capture on an order that has moved on — cancelled, or already confirmed by hand — is
    // a late or replayed callback. Changing nothing is the only safe answer.
    if (toStatus === null) return ignore('order_not_pending')
    if (!canTransition(order.status, toStatus)) return ignore('order_not_pending')

    return { action: 'apply', toStatus, toPaymentStatus: 'paid', note: eventNote(event) }
  }

  if (event.type === 'payment.failed') {
    if (order.paymentStatus === 'paid') return ignore('already_paid')
    if (!canTransitionPayment(order.paymentStatus, 'failed')) return ignore('already_paid')

    const toStatus = statusAfterPaymentFailure(order.status)
    if (toStatus === null) return ignore('order_not_pending')

    return { action: 'apply', toStatus, toPaymentStatus: 'failed', note: eventNote(event) }
  }

  if (event.type === 'refund.processed') {
    if (!canTransitionPayment(order.paymentStatus, 'refunded')) return ignore('not_refundable')
    if (!canTransition(order.status, 'refunded')) return ignore('not_refundable')

    return { action: 'apply', toStatus: 'refunded', toPaymentStatus: 'refunded', note: eventNote(event) }
  }

  return ignore('unsupported_event')
}

/**
 * Whether the decision means stock has been sold for good.
 *
 * A confirmed payment converts the reservation into an `out` movement; a failure gives the units
 * back. Keeping this beside the decision means the webhook handler never has to work it out from
 * the status names.
 */
export function stockActionFor(decision: PaymentApplyDecision): 'commit' | 'release' | 'none' {
  if (decision.action === 'ignore') return 'none'
  if (decision.toPaymentStatus === 'paid') return 'commit'
  if (decision.toPaymentStatus === 'failed') return 'release'

  return 'none'
}
