/**
 * An order's history, as the customer should read it.
 *
 * Built from `orderEvents` — the append-only trail that `payloadOrders.transition` has written on
 * every status change since J4. That matters more than it looks: the alternative is a second
 * narrative assembled from timestamp columns (`placedAt`, `deliveredAt`, …), which drifts from the
 * audit trail the moment a status moves in a way nobody anticipated. One record, read twice.
 *
 * Three rules shape what a customer sees.
 *
 * **Internal steps are not shown.** `packed` means a box exists on a table; a customer watching
 * their parcel does not need it, and the same reasoning that keeps `statusNotification.ts` quiet
 * about it applies here. The list is deliberately the *same* list, so the timeline and the emails
 * cannot tell different stories.
 *
 * **Notes are dropped, not displayed.** An `orderEvents.note` carries provider event ids
 * (`stub_evt_…`) and staff shorthand. It is an audit field, and audit fields leak (OWASP A09).
 *
 * **The trail is not trusted to be ordered.** Rows arrive in whatever order the query returned, and
 * two events can share a timestamp; sorting here is what stops "delivered" appearing above
 * "shipped" on a customer's screen.
 */
import type { OrderStatus } from '@/types'

/** One step, as rendered. */
export interface TimelineStep {
  status: OrderStatus
  /** What the customer reads. */
  label: string
  /** One line of context, or null when the label says it all. */
  detail: string | null
  /** ISO. */
  at: string
}

/** Just enough of an `orderEvents` row to build a step. */
export interface TimelineEvent {
  toStatus: OrderStatus
  createdAt: string
}

/**
 * How each status reads to a customer, and whether it is theirs to see.
 *
 * `null` is "internal — do not show". Exhaustive over `OrderStatus`, so a new status has to be given
 * an answer rather than silently defaulting into a customer's timeline.
 */
export const TIMELINE_LABELS: Readonly<Record<OrderStatus, { label: string; detail: string | null } | null>> =
  Object.freeze({
    pending: { label: 'Order placed', detail: 'We have your order and are waiting on payment.' },
    confirmed: { label: 'Payment received', detail: 'Your order is confirmed.' },
    // A box on a table is not news.
    packed: null,
    shipped: { label: 'On its way', detail: 'Handed to the courier.' },
    out_for_delivery: { label: 'Out for delivery', detail: 'Arriving today.' },
    delivered: { label: 'Delivered', detail: null },
    cancelled: { label: 'Cancelled', detail: 'This order was cancelled.' },
    rto: { label: 'Returned to us', detail: 'The parcel came back. We will be in touch.' },
    payment_failed: { label: 'Payment failed', detail: 'Nothing was charged.' },
    returned: { label: 'Return received', detail: 'We have your return.' },
    refunded: { label: 'Refunded', detail: 'Your refund is on its way back to you.' },
  })

/**
 * Build the timeline.
 *
 * Sorted oldest first, because a timeline reads downwards. Ties are broken by the order the events
 * arrived in, which for same-millisecond writes is the order they happened.
 */
export function buildTimeline(events: readonly TimelineEvent[]): TimelineStep[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const at = Date.parse(a.event.createdAt)
      const bt = Date.parse(b.event.createdAt)

      // An unparseable timestamp sorts to the end rather than to 1970, where it would claim to be
      // the first thing that ever happened to the order.
      if (Number.isNaN(at) && Number.isNaN(bt)) return a.index - b.index
      if (Number.isNaN(at)) return 1
      if (Number.isNaN(bt)) return -1

      return at === bt ? a.index - b.index : at - bt
    })
    .flatMap(({ event }) => {
      const entry = TIMELINE_LABELS[event.toStatus]

      if (entry === null || entry === undefined) return []

      return [{ status: event.toStatus, label: entry.label, detail: entry.detail, at: event.createdAt }]
    })
}

/**
 * Whether an order is still moving.
 *
 * Drives whether the timeline renders an open end. A terminal order's timeline is finished; an
 * in-flight one should not look finished, or a customer reads "on its way" as the last word.
 */
export function isTimelineOpen(status: OrderStatus): boolean {
  return !['delivered', 'cancelled', 'refunded', 'payment_failed', 'returned'].includes(status)
}
