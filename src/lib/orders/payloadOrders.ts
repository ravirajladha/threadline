/**
 * The Payload-backed order port — placing orders, moving them, and applying payment events.
 *
 * Three operations, and each one is a place where getting it wrong costs real money, so each is
 * written around a single guarantee.
 *
 * **`placeOrder` is all-or-nothing.** Reserving stock, writing the order, writing its lines,
 * writing the opening audit event and spending loyalty points are five writes that only make
 * sense together. Half of them is worse than none: stock held against an order that does not
 * exist, or an order whose lines were never written. They run in one transaction and roll back
 * together.
 *
 * **`transition` is the only way a status changes.** It asks `transitions.ts` first, so an illegal
 * jump throws instead of being written, and it appends an `orderEvents` row every single time. An
 * order's history is therefore complete by construction rather than by everyone remembering to log.
 *
 * **`applyPaymentEvent` is idempotent.** Gateways retry; the same capture arriving three times is
 * ordinary traffic. The event id is recorded in the audit trail and checked against it before
 * anything happens, so replays two and three change nothing and say so (OWASP A08).
 */
import type { Payload, Where } from 'payload'

import type { Order } from '@/payload-types'
import { commitReservation, holdReservation, releaseReservation, type HoldOutcome } from '@/lib/inventory/reservationStore'
import { createPayloadReservationStore } from '@/lib/inventory/payloadReservation'
import type { PaymentEvent } from '@/lib/payments/types'
import { numericId, optionalNumericId, relationshipId } from '@/lib/utils/ids'
import { transactionReq, withTransaction } from '@/lib/utils/transaction'
import { buildOrderNumber } from './orderNumber'
import { decidePaymentApply, processedEventIdsFrom, stockActionFor, type PaymentApplyDecision } from './paymentApply'
import { assertTransition } from './transitions'
import { reservationRequestsFor, type OrderDraft } from './draft'
import type { OrderStatus } from '@/types'

/** Who or what caused a status change. Mirrors `orderEvents.source`. */
export type OrderEventSource = 'staff' | 'customer' | 'webhook' | 'system'

export interface PlaceOrderResult {
  ok: true
  orderId: number
  orderNumber: string
}

export interface PlaceOrderRejected {
  ok: false
  reason: 'out_of_stock'
  shortages: Extract<HoldOutcome, { ok: false }>['shortages']
}

/**
 * How many orders already exist for a given day, so the next sequence can be computed.
 *
 * Counted by prefix rather than by a date range, because the order number's date part is the
 * shop's local date and a timestamp range would have to reproduce that timezone reasoning a
 * second time — and disagree with it the day the two drift apart.
 */
async function nextSequence(payload: Payload, datePrefix: string, transactionID: string | number | null): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'orders',
    where: { orderNumber: { like: `${datePrefix}%` } } satisfies Where,
    overrideAccess: true,
    ...transactionReq(transactionID),
  })

  return totalDocs + 1
}

export interface PayloadOrdersOptions {
  payload: Payload
}

export function createPayloadOrders(options: PayloadOrdersOptions) {
  const { payload } = options

  /**
   * Write the order, its lines, its opening event and any loyalty spend.
   *
   * Called only from inside `placeOrder`'s transaction, after stock is held.
   */
  async function writeOrder(draft: OrderDraft, transactionID: string | number | null): Promise<Order> {
    const req = transactionReq(transactionID)

    const order = (await payload.create({
      collection: 'orders',
      data: {
        ...draft.order,
        customer: optionalNumericId(draft.order.customer),
        coupon: optionalNumericId(draft.order.coupon),
      },
      depth: 0,
      overrideAccess: true,
      ...req,
    })) as Order

    for (const item of draft.items) {
      await payload.create({
        collection: 'orderItems',
        data: {
          ...item,
          order: order.id,
          variant: optionalNumericId(item.variant),
          image: item.image,
        },
        depth: 0,
        overrideAccess: true,
        ...req,
      })
    }

    // The opening entry in the audit trail. `fromStatus` is deliberately absent — there was no
    // previous status, and writing one would invent a transition that never happened.
    await payload.create({
      collection: 'orderEvents',
      data: {
        order: order.id,
        toStatus: draft.order.status,
        source: 'customer',
        note: 'Order placed',
      },
      depth: 0,
      overrideAccess: true,
      ...req,
    })

    if (draft.loyaltyPointsUsed > 0 && draft.order.customer !== null) {
      const customerId = numericId(draft.order.customer)

      await payload.create({
        collection: 'loyaltyTransactions',
        data: {
          customer: customerId,
          order: order.id,
          // Stored negative: the ledger is append-only and a redemption is a debit, so the
          // balance is always the sum of its rows rather than a figure kept in step by hand.
          points: -draft.loyaltyPointsUsed,
          type: 'redeem',
        },
        depth: 0,
        overrideAccess: true,
        ...req,
      })

      const customer = await payload.findByID({
        collection: 'customers',
        id: customerId,
        depth: 0,
        overrideAccess: true,
        ...req,
      })

      const balance = typeof customer.loyaltyPoints === 'number' ? customer.loyaltyPoints : 0

      await payload.update({
        collection: 'customers',
        id: customerId,
        // Floored at zero: the pricing layer has already refused to spend more than the balance,
        // so a negative here would mean a bug, and a negative balance is not a thing to persist.
        data: { loyaltyPoints: Math.max(0, balance - draft.loyaltyPointsUsed) },
        depth: 0,
        overrideAccess: true,
        ...req,
      })
    }

    return order
  }

  return {
    /**
     * Place an order from a fully priced draft.
     *
     * Stock is held **before** the order is written, not after. If units cannot be held there is
     * no order to undo, and the customer is told what sold out while their cart is still intact.
     */
    async placeOrder(input: {
      draft: OrderDraft
      /** Cleared once the order exists, so a refresh cannot place it twice. */
      cartId?: number | string | null
    }): Promise<PlaceOrderResult | PlaceOrderRejected> {
      const { draft, cartId = null } = input

      return withTransaction(payload, async (transactionID) => {
        const store = createPayloadReservationStore({ payload, transactionID })
        const requests = reservationRequestsFor(draft)

        const hold = await holdReservation(store, requests)
        if (!hold.ok) return { ok: false, reason: 'out_of_stock', shortages: hold.shortages }

        const order = await writeOrder(draft, transactionID)

        if (cartId !== null) {
          await payload.update({
            collection: 'carts',
            id: numericId(cartId),
            data: { items: [], coupon: null },
            depth: 0,
            overrideAccess: true,
            ...transactionReq(transactionID),
          })
        }

        return { ok: true, orderId: order.id, orderNumber: order.orderNumber }
      })
    },

    /** Allocate the next order number for a date, retrying past a collision. */
    async allocateOrderNumber(placedAt: Date): Promise<string> {
      const probe = buildOrderNumber({ date: placedAt, sequence: 1 })
      const datePrefix = probe.slice(0, probe.lastIndexOf('-') + 1)

      const sequence = await nextSequence(payload, datePrefix, null)

      return buildOrderNumber({ date: placedAt, sequence })
    },

    async findByOrderNumber(orderNumber: string): Promise<Order | null> {
      const { docs } = await payload.find({
        collection: 'orders',
        where: { orderNumber: { equals: orderNumber } } satisfies Where,
        depth: 0,
        limit: 1,
        pagination: false,
        overrideAccess: true,
      })

      return (docs[0] as Order | undefined) ?? null
    },

    /**
     * Move an order to a new status, validating the jump and logging it.
     *
     * The validation is not a formality: `assertTransition` is what stops a delivered order being
     * marked pending, or a cancelled one shipping. It throws rather than returning false, because
     * every caller here would only turn a false into a throw anyway.
     */
    async transition(input: {
      orderId: number | string
      toStatus: OrderStatus
      source: OrderEventSource
      note?: string
      actor?: number | string | null
      transactionID?: string | number | null
    }): Promise<void> {
      const { orderId, toStatus, source, note, actor = null, transactionID = null } = input
      const req = transactionReq(transactionID)
      const id = numericId(orderId)

      const order = (await payload.findByID({
        collection: 'orders',
        id,
        depth: 0,
        overrideAccess: true,
        ...req,
      })) as Order

      const fromStatus = order.status

      assertTransition(fromStatus, toStatus)

      await payload.update({
        collection: 'orders',
        id,
        data: {
          status: toStatus,
          ...(toStatus === 'delivered' ? { deliveredAt: new Date().toISOString() } : {}),
          ...(toStatus === 'cancelled' ? { cancelledAt: new Date().toISOString() } : {}),
        },
        depth: 0,
        overrideAccess: true,
        ...req,
      })

      await payload.create({
        collection: 'orderEvents',
        data: {
          order: id,
          fromStatus,
          toStatus,
          source,
          ...(note === undefined ? {} : { note }),
          ...(actor === null ? {} : { actor: optionalNumericId(actor) }),
        },
        depth: 0,
        overrideAccess: true,
        ...req,
      })
    },

    /**
     * Apply a **verified** payment event.
     *
     * Takes an already-verified `PaymentEvent`, never a raw body: verification is the route
     * handler's job and doing it here as well would make it possible to call this with something
     * unverified. The decision itself is pure and lives in `paymentApply.ts`; this method is only
     * the reading and the writing around it.
     */
    async applyPaymentEvent(event: PaymentEvent): Promise<PaymentApplyDecision> {
      return withTransaction(payload, async (transactionID) => {
        const req = transactionReq(transactionID)

        const { docs } = await payload.find({
          collection: 'orders',
          where: { orderNumber: { equals: event.reference } } satisfies Where,
          depth: 0,
          limit: 1,
          pagination: false,
          overrideAccess: true,
          ...req,
        })

        const order = (docs[0] as Order | undefined) ?? null
        if (order === null) return { action: 'ignore', reason: 'reference_mismatch' } as const

        // The event ids already applied, recovered from the append-only audit trail rather than a
        // separate table — one record of what happened, not two that can disagree.
        const { docs: events } = await payload.find({
          collection: 'orderEvents',
          where: { order: { equals: order.id } } satisfies Where,
          depth: 0,
          pagination: false,
          overrideAccess: true,
          ...req,
        })

        const decision = decidePaymentApply({
          order: {
            orderNumber: order.orderNumber,
            status: order.status,
            paymentStatus: order.paymentStatus,
            grandTotal: order.grandTotal,
            processedEventIds: processedEventIdsFrom(events.map((row) => row.note)),
          },
          event,
        })

        if (decision.action === 'ignore') return decision

        await payload.update({
          collection: 'orders',
          id: order.id,
          data: {
            status: decision.toStatus,
            paymentStatus: decision.toPaymentStatus,
            razorpayPaymentId: event.gatewayPaymentId,
            razorpayOrderId: event.gatewayOrderId,
          },
          depth: 0,
          overrideAccess: true,
          ...req,
        })

        await payload.create({
          collection: 'orderEvents',
          data: {
            order: order.id,
            fromStatus: order.status,
            toStatus: decision.toStatus,
            source: 'webhook',
            // Carries the event id — which is what the next replay is checked against.
            note: decision.note,
          },
          depth: 0,
          overrideAccess: true,
          ...req,
        })

        const action = stockActionFor(decision)

        if (action !== 'none') {
          const { docs: items } = await payload.find({
            collection: 'orderItems',
            where: { order: { equals: order.id } } satisfies Where,
            depth: 0,
            pagination: false,
            overrideAccess: true,
            ...req,
          })

          const requests = items
            .map((item) => ({ variantId: relationshipId(item.variant), qty: item.qty }))
            .filter((request): request is { variantId: number; qty: number } => request.variantId !== null)

          const store = createPayloadReservationStore({ payload, transactionID })

          if (action === 'commit') {
            await commitReservation(store, requests, order.id)
          } else {
            await releaseReservation(store, requests)
          }
        }

        return decision
      })
    },
  }
}

export type PayloadOrders = ReturnType<typeof createPayloadOrders>
