/**
 * A customer's own orders.
 *
 * The read side of the account, and the whole of it is one rule, carried over verbatim from
 * `support/payloadTickets.ts`: **an order number is a reference, not a credential.** It is printed
 * on emails, quoted down the phone and sits in a URL, and J4's own log spells out why counting
 * upwards through them must reveal nothing — a date plus a small daily sequence is trivially walked.
 *
 * So the lookup and the ownership check are **one function**. A lookup that returns the order and a
 * guard that runs afterwards is two things that can drift apart, and the drift is silent. A
 * customer quoting somebody else's reference gets the same `null` as a reference that does not
 * exist, which is both the safe answer and the honest one.
 *
 * Guest orders are deliberately unreachable here. A guest checkout stores an email and no customer,
 * so nothing links it to an account — the confirmation cookie from J4 is how a guest sees their
 * order, and matching on email instead would hand every guest order to whoever later registers that
 * address (OWASP A01).
 */
import type { Payload, Where } from 'payload'

import { customerIdOf } from '@/access'
import type { Order, OrderItem } from '@/payload-types'
import { numericId, relationshipId } from '@/lib/utils/ids'
import { buildTimeline, type TimelineEvent, type TimelineStep } from './timeline'

/** One line of an order, flattened for rendering. */
export interface AccountOrderLine {
  /** Needed by the returns flow, which names lines by their `orderItems` id. */
  orderItemId: number
  sku: string
  productTitle: string
  sizeLabel: string
  colourName: string
  qty: number
  imageId: number | null
}

/** An order as the account renders it. Deliberately not the Payload document. */
export interface AccountOrderView {
  orderNumber: string
  status: Order['status']
  paymentStatus: Order['paymentStatus']
  paymentMethod: Order['paymentMethod']
  placedAt: string | null
  /** When the courier delivered it. Drives the return window. */
  deliveredAt: string | null
  grandTotal: number
  itemCount: number
  /** Present only once a courier has the parcel. */
  awbCode: string | null
  courier: string | null
}

export interface AccountOrderDetail extends AccountOrderView {
  lines: AccountOrderLine[]
  timeline: TimelineStep[]
  subtotal: number
  shipping: number
  taxTotal: number
  discount: number
  loyaltyDiscount: number
}

function toView(order: Order, itemCount: number): AccountOrderView {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    placedAt: typeof order.placedAt === 'string' ? order.placedAt : null,
    deliveredAt: typeof order.deliveredAt === 'string' ? order.deliveredAt : null,
    grandTotal: order.grandTotal,
    itemCount,
    awbCode: typeof order.awbCode === 'string' && order.awbCode.length > 0 ? order.awbCode : null,
    courier: typeof order.courier === 'string' && order.courier.length > 0 ? order.courier : null,
  }
}

export function createAccountOrders(options: { payload: Payload }) {
  const { payload } = options

  return {
    /**
     * The signed-in customer's orders, newest first.
     *
     * Scoped in the *query* by the session's customer id, so another customer's row is never
     * fetched rather than being fetched and filtered.
     */
    async list(user: unknown): Promise<AccountOrderView[]> {
      const customerId = customerIdOf(user)
      if (customerId === null) return []

      const { docs } = await payload.find({
        collection: 'orders',
        where: { customer: { equals: numericId(customerId) } } satisfies Where,
        sort: '-placedAt',
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })

      const orders = docs as Order[]
      if (orders.length === 0) return []

      // Line counts for the whole page in one query rather than one per order — a customer with
      // thirty orders would otherwise be thirty round trips for a number on a card.
      const { docs: items } = await payload.find({
        collection: 'orderItems',
        where: { order: { in: orders.map((order) => order.id) } } satisfies Where,
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })

      const counts = new Map<number, number>()
      for (const item of items as OrderItem[]) {
        const orderId = relationshipId(item.order)
        if (orderId === null) continue
        counts.set(orderId, (counts.get(orderId) ?? 0) + item.qty)
      }

      return orders.map((order) => toView(order, counts.get(order.id) ?? 0))
    },

    /**
     * One order, and the check that this customer may see it.
     *
     * Returns null for "no such order" and for "not yours" alike — the caller turns both into the
     * same `notFound()`, so the two are indistinguishable from outside.
     */
    async find(orderNumber: string, user: unknown): Promise<AccountOrderDetail | null> {
      const customerId = customerIdOf(user)
      if (customerId === null) return null

      const { docs } = await payload.find({
        collection: 'orders',
        // Both conditions in the query, not one here and one in a branch below: the database
        // returning nothing is a stronger guarantee than code choosing to ignore what it got.
        where: {
          and: [
            { orderNumber: { equals: orderNumber } },
            { customer: { equals: numericId(customerId) } },
          ],
        } satisfies Where,
        depth: 0,
        limit: 1,
        pagination: false,
        overrideAccess: true,
      })

      const order = (docs[0] as Order | undefined) ?? null
      if (order === null) return null

      const [{ docs: items }, { docs: events }] = await Promise.all([
        payload.find({
          collection: 'orderItems',
          where: { order: { equals: order.id } } satisfies Where,
          depth: 0,
          pagination: false,
          overrideAccess: true,
        }),
        payload.find({
          collection: 'orderEvents',
          where: { order: { equals: order.id } } satisfies Where,
          depth: 0,
          pagination: false,
          overrideAccess: true,
        }),
      ])

      const lines = (items as OrderItem[]).map((item) => ({
        orderItemId: item.id,
        sku: item.sku,
        productTitle: item.productTitle,
        sizeLabel: item.sizeLabel,
        colourName: item.colourName,
        qty: item.qty,
        imageId: relationshipId(item.image),
      }))

      const timeline = buildTimeline(
        events.flatMap((event) => {
          const createdAt = typeof event.createdAt === 'string' ? event.createdAt : null
          if (createdAt === null) return []

          return [{ toStatus: event.toStatus, createdAt } satisfies TimelineEvent]
        }),
      )

      return {
        ...toView(order, lines.reduce((total, line) => total + line.qty, 0)),
        lines,
        timeline,
        subtotal: order.subtotal,
        shipping: order.shipping,
        taxTotal: order.taxTotal,
        discount: order.discount,
        loyaltyDiscount: order.loyaltyDiscount,
      }
    },
  }
}

export type AccountOrders = ReturnType<typeof createAccountOrders>
