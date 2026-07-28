/**
 * Which status change tells the customer what.
 *
 * Pure, and separate from the port that calls it, because "does `packed` deserve an email" is a
 * judgement about the shop rather than a fact about the database — and it is the kind of judgement
 * that gets revisited.
 *
 * **Not every status is an event.** `packed` is deliberately silent: it means a box exists on a
 * table, which is not news, and a shop that emails at every internal step teaches customers to
 * filter it. `rto` is silent to the customer too — a parcel coming back to us needs staff
 * attention, not a message explaining a failure the customer may not have caused. `returned` is
 * silent because the refund that follows it is the thing worth saying.
 *
 * The map is over `OrderStatus` and exhaustive, so a status added to the machine has to be given an
 * answer here rather than silently defaulting to "say nothing".
 */
import type { NotificationMessage } from '@/lib/notify/templates'
import type { NotificationEvent, OrderStatus } from '@/types'

/** The message a status announces, or null when the change is internal. */
export const STATUS_NOTIFICATIONS: Readonly<Record<OrderStatus, NotificationEvent | null>> =
  Object.freeze({
    // The opening message is sent by checkout, which knows the item count and the total. Sending it
    // from here as well would mean two "we've got your order" emails for one order.
    pending: null,
    confirmed: 'order.confirmed',
    packed: null,
    shipped: 'order.shipped',
    out_for_delivery: 'order.out_for_delivery',
    delivered: 'order.delivered',
    cancelled: 'order.cancelled',
    rto: null,
    // A failed payment is not chased by email: the customer is looking at the failure page, and a
    // second telling is noise at the worst moment.
    payment_failed: null,
    returned: null,
    refunded: 'order.refunded',
  })

export function notificationForStatus(status: OrderStatus): NotificationEvent | null {
  return STATUS_NOTIFICATIONS[status]
}

/**
 * The subject key for a status message.
 *
 * Order number plus status, so an order that is cancelled and later refunded gets both messages,
 * while the same status arriving twice — a replayed courier scan that somehow got past the event-id
 * check — gets one. The status machine already forbids re-entering a status, so this is a second
 * belt rather than the only one.
 */
export function statusSubject(orderNumber: string, status: OrderStatus): string {
  return `order:${orderNumber}:${status}`
}

/** The fields a status message can draw on. A slice of the order, not the document. */
export interface StatusNotificationSource {
  orderNumber: string
  grandTotal: number
  courier?: string | null
  awbCode?: string | null
}

/**
 * The message a status change should send, or null.
 *
 * Returns the event and its variables as a correlated pair, so the caller cannot pair `shipped`
 * with a refund's figures. Building it here rather than in the port keeps the whole
 * "what do we say, and with what" decision in one testable place.
 *
 * A courier or AWB we do not have becomes a readable placeholder rather than the word `null` in a
 * customer's email. It should never happen — `fulfilment.ts` refuses to ship without an AWB — but
 * an empty tracking number in an email is a support conversation, and this costs one line.
 */
export function statusMessageFor(
  status: OrderStatus,
  order: StatusNotificationSource,
): NotificationMessage | null {
  const event = notificationForStatus(status)
  if (event === null) return null

  const courier = order.courier?.trim() ?? ''
  const awbCode = order.awbCode?.trim() ?? ''

  switch (event) {
    case 'order.confirmed':
      return { event, variables: { orderNumber: order.orderNumber, totalPaise: order.grandTotal } }
    case 'order.shipped':
      return {
        event,
        variables: {
          orderNumber: order.orderNumber,
          courier: courier.length > 0 ? courier : 'Our courier',
          awbCode: awbCode.length > 0 ? awbCode : 'available shortly',
        },
      }
    case 'order.out_for_delivery':
      return {
        event,
        variables: { orderNumber: order.orderNumber, courier: courier.length > 0 ? courier : 'Our courier' },
      }
    case 'order.delivered':
    case 'order.cancelled':
      return { event, variables: { orderNumber: order.orderNumber } }
    case 'order.refunded':
      return { event, variables: { orderNumber: order.orderNumber, totalPaise: order.grandTotal } }
    default:
      // `STATUS_NOTIFICATIONS` only ever names the events handled above. This arm exists so that
      // adding a status *and* a new event for it fails here rather than silently sending nothing.
      return null
  }
}
