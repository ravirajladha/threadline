/**
 * What a verified tracking event should do to an order.
 *
 * Pure, and the counterpart to `orders/paymentApply.ts` — same division of labour: this file decides,
 * `payloadShipping.ts` reads and writes. Keeping the decision pure is what makes the awkward cases
 * testable without a courier, a webhook or a database, and the awkward cases are the whole job here.
 *
 * A courier is a much noisier source than a payment gateway. It sends many events per parcel, retries
 * them, replays them, sends them out of order, and adds new status strings without warning. So the
 * decision has to answer "do nothing" in several distinguishable ways rather than just refusing.
 */
import type { OrderStatus } from '@/types'
import { canTransition } from '@/lib/orders/transitions'
import { mapCourierStatus } from './statusMap'
import type { TrackingEvent } from './types'

/** Just enough of an order to decide. Deliberately not the Payload document. */
export interface TrackingOrderState {
  orderNumber: string
  status: OrderStatus
  /** The AWB we booked, or null if this order has no parcel yet. */
  awbCode: string | null
  /** Tracking event ids already applied, recovered from the `orderEvents` trail. */
  processedEventIds: readonly string[]
}

export type TrackingIgnoreReason =
  /** The event names an order number that is not this one. */
  | 'reference_mismatch'
  /** Right order, wrong parcel — the AWB does not match the one we booked. */
  | 'awb_mismatch'
  /** Already applied. Ordinary traffic: couriers retry. */
  | 'duplicate_event'
  /** Recognised scan that moves no order — a pickup being scheduled, a failed delivery attempt. */
  | 'informational'
  /** A status string not in the table. Worth a warning: the integration may have drifted. */
  | 'unknown_status'
  /** Recognised, but the order cannot legally move there — a late or out-of-order scan. */
  | 'not_applicable'

export type TrackingApplyDecision =
  | { action: 'apply'; toStatus: OrderStatus; note: string }
  | { action: 'ignore'; reason: TrackingIgnoreReason; courierStatus: string }

/**
 * The `orderEvents.note` an applied tracking event writes.
 *
 * The event id has to survive in the trail, because that trail is what the next replay is checked
 * against. The courier's own status goes in too — it is what a support conversation will be about, and
 * "shipped" alone loses which scan caused it. Nothing else: no location, no address, no customer
 * detail (OWASP A09).
 */
export function trackingNote(event: TrackingEvent): string {
  return `${event.courierStatus} ${event.id}`
}

/**
 * Decide what to do with a **verified** tracking event.
 *
 * The order of the checks is the security order, as in `decidePaymentApply`: identity of the order
 * first, then of the parcel, then whether we have already seen the event, and only then what it means.
 * Checking identity last would mean a stranger's event id could be recorded against our order.
 */
export function decideTrackingApply(input: {
  order: TrackingOrderState
  event: TrackingEvent
}): TrackingApplyDecision {
  const { order, event } = input
  const courierStatus = event.courierStatus

  if (event.reference !== order.orderNumber) {
    return { action: 'ignore', reason: 'reference_mismatch', courierStatus }
  }

  // A courier reporting a different AWB against this order number means the two systems disagree
  // about which parcel this is. Acting on it could mark an order delivered because a *different*
  // parcel arrived. An order with no AWB yet accepts the event — scans can legitimately arrive before
  // our own booking write has landed.
  if (order.awbCode !== null && order.awbCode.length > 0 && order.awbCode !== event.awbCode) {
    return { action: 'ignore', reason: 'awb_mismatch', courierStatus }
  }

  if (order.processedEventIds.includes(event.id)) {
    return { action: 'ignore', reason: 'duplicate_event', courierStatus }
  }

  const mapped = mapCourierStatus(courierStatus)

  if (mapped.kind === 'unknown') {
    return { action: 'ignore', reason: 'unknown_status', courierStatus }
  }

  if (mapped.kind === 'no_change') {
    return { action: 'ignore', reason: 'informational', courierStatus }
  }

  // A scan implying a status the order cannot reach is a replay, an out-of-order delivery, or a
  // courier telling us about something a human already recorded. Changing nothing is the only safe
  // answer — and it must be an *ignore* rather than a throw, because answering a courier with a 500
  // buys nothing but a retry storm.
  if (!canTransition(order.status, mapped.status)) {
    return { action: 'ignore', reason: 'not_applicable', courierStatus }
  }

  return { action: 'apply', toStatus: mapped.status, note: trackingNote(event) }
}

/**
 * Whether an ignored event is worth a warning rather than an info log.
 *
 * Only `unknown_status` is: every other reason is ordinary courier noise, while an unrecognised status
 * means the provider's vocabulary has moved and `statusMap.ts` needs a row. Without this distinction
 * the drift is invisible in a log full of routine duplicates.
 */
export function isNoteworthy(decision: TrackingApplyDecision): boolean {
  return decision.action === 'ignore' && decision.reason === 'unknown_status'
}
