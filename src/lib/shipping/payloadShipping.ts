/**
 * The Payload-backed shipping port — booking a parcel, and applying what the courier tells us.
 *
 * Two operations, each written around one guarantee.
 *
 * **`bookShipment` is idempotent by the AWB already on the order.** A double-clicked button, a retried
 * request or two staff members acting at once must not book two parcels for one order — that is a real
 * cost and a customer receiving two boxes. The order row is locked first, so the second caller reads
 * the AWB the first one wrote and returns it instead of booking again.
 *
 * **`applyTrackingEvent` changes status only through `payloadOrders.transition`.** It never writes
 * `orders.status` itself. That is what keeps the status machine and the audit trail honest: every
 * change is validated, and every change writes an `orderEvents` row, because there is exactly one code
 * path that can do it. Reusing `transition` also inherits its row lock (J4's fix).
 *
 * Note what is deliberately *absent*: no stock movement. A delivery does not touch stock — it was
 * committed when payment was captured — and an RTO or a return gives units back only through the
 * returns flow at J8, where the goods are inspected first. Guessing here would credit stock for a
 * parcel nobody has looked at.
 */
import type { Payload, Where } from 'payload'

import type { Order, OrderItem, Variant } from '@/payload-types'
import { eventIdsFrom, TRACKING_EVENT_ID_PREFIXES } from '@/lib/orders/eventTrail'
import { canBookShipment } from '@/lib/orders/fulfilment'
import { createPayloadOrders, lockOrderByNumber, lockOrderById } from '@/lib/orders/payloadOrders'
import { numericId, relationshipId } from '@/lib/utils/ids'
import { transactionReq, withTransaction } from '@/lib/utils/transaction'
import { decideTrackingApply, type TrackingApplyDecision } from './trackingApply'
import type { ShipmentRequest, ShippingProvider, TrackingEvent } from './types'

/**
 * Fallback weight for a garment whose variant has none recorded.
 *
 * A courier rejects a weightless parcel, so a missing figure cannot become zero. 300g is a plausible
 * single garment; it is a floor to keep booking working, not an estimate anyone should rely on, and the
 * variant field is the thing to fill in.
 */
const DEFAULT_ITEM_WEIGHT_GRAMS = 300

export type BookShipmentResult =
  | { ok: true; awbCode: string; courier: string; alreadyBooked: boolean }
  | { ok: false; reason: 'not_found' | 'not_bookable' | 'no_pincode' | 'no_items' }

export interface PayloadShippingOptions {
  payload: Payload
  provider: ShippingProvider
}

export function createPayloadShipping(options: PayloadShippingOptions) {
  const { payload, provider } = options
  const orders = createPayloadOrders({ payload })

  /**
   * Total parcel weight, from the variants behind the order's lines.
   *
   * Read per order rather than snapshotted onto `orderItems`, because weight is a property of the
   * garment now, not of the sale — and unlike price, nobody is owed the weight it had at checkout.
   */
  async function parcelWeightFor(
    items: readonly OrderItem[],
    transactionID: string | number | null,
  ): Promise<number> {
    const variantIds = items
      .map((item) => relationshipId(item.variant))
      .filter((id): id is number => id !== null)

    if (variantIds.length === 0) {
      return items.reduce((total, item) => total + DEFAULT_ITEM_WEIGHT_GRAMS * item.qty, 0)
    }

    const { docs } = await payload.find({
      collection: 'variants',
      where: { id: { in: variantIds } } satisfies Where,
      depth: 0,
      pagination: false,
      overrideAccess: true,
      ...transactionReq(transactionID),
    })

    const weights = new Map<number, number>()
    for (const doc of docs as Variant[]) {
      const grams = typeof doc.weightGrams === 'number' && doc.weightGrams > 0 ? doc.weightGrams : null
      weights.set(doc.id, grams ?? DEFAULT_ITEM_WEIGHT_GRAMS)
    }

    return items.reduce((total, item) => {
      const id = relationshipId(item.variant)
      const grams = id === null ? DEFAULT_ITEM_WEIGHT_GRAMS : (weights.get(id) ?? DEFAULT_ITEM_WEIGHT_GRAMS)

      return total + grams * item.qty
    }, 0)
  }

  return {
    /**
     * Ask the courier for a parcel, and record what it gave us.
     *
     * The lock is taken before the AWB is read, for the same reason `applyPaymentEvent` locks before
     * reading the event trail: read-then-act on a value another request is writing is a race, and here
     * losing it means two parcels.
     */
    async bookShipment(orderId: number | string): Promise<BookShipmentResult> {
      const id = numericId(orderId)

      return withTransaction(payload, async (transactionID) => {
        const req = transactionReq(transactionID)

        await lockOrderById(payload, id, transactionID)

        const order = (await payload.findByID({
          collection: 'orders',
          id,
          depth: 0,
          overrideAccess: true,
          ...req,
        })) as Order | null

        if (order === null) return { ok: false, reason: 'not_found' } as const

        // Already booked. Returning the existing AWB rather than an error, because the caller wanted a
        // parcel and there is one — a second click should be uneventful, not a failure.
        if (typeof order.awbCode === 'string' && order.awbCode.length > 0) {
          return {
            ok: true,
            awbCode: order.awbCode,
            courier: typeof order.courier === 'string' ? order.courier : provider.name,
            alreadyBooked: true,
          } as const
        }

        if (!canBookShipment(order.status)) return { ok: false, reason: 'not_bookable' } as const

        const pincode = order.shippingAddress?.pincode
        if (typeof pincode !== 'string' || pincode.length === 0) {
          return { ok: false, reason: 'no_pincode' } as const
        }

        const { docs: items } = await payload.find({
          collection: 'orderItems',
          where: { order: { equals: id } } satisfies Where,
          depth: 0,
          pagination: false,
          overrideAccess: true,
          ...req,
        })

        const orderItems = items as OrderItem[]
        if (orderItems.length === 0) return { ok: false, reason: 'no_items' } as const

        const request: ShipmentRequest = {
          reference: order.orderNumber,
          pincode,
          // Cash to collect is the order's own total, never a figure from a caller (OWASP A04).
          codAmountPaise: order.paymentMethod === 'cod' ? order.grandTotal : 0,
          weightGrams: await parcelWeightFor(orderItems, transactionID),
          parcelItems: orderItems.map((item) => ({ sku: item.sku, qty: item.qty })),
        }

        const shipment = await provider.createShipment(request)

        await payload.update({
          collection: 'orders',
          id,
          data: {
            awbCode: shipment.awbCode,
            courier: shipment.courier,
            shiprocketOrderId: shipment.providerShipmentId,
          },
          depth: 0,
          overrideAccess: true,
          ...req,
        })

        // Logged rather than written to `orderEvents`: booking is not a status change, and inventing a
        // `toStatus` for it would put a transition in the trail that never happened (OWASP A09 — the
        // AWB and order number are traceable, and neither is customer data).
        payload.logger.info(
          {
            orderNumber: order.orderNumber,
            awbCode: shipment.awbCode,
            courier: shipment.courier,
            provider: provider.name,
          },
          'Shipment booked',
        )

        return { ok: true, awbCode: shipment.awbCode, courier: shipment.courier, alreadyBooked: false } as const
      })
    },

    /**
     * Apply a **verified** tracking event.
     *
     * Takes an already-verified `TrackingEvent`, never a raw body: verification is the route handler's
     * job, and doing it here as well would make it possible to call this with something unverified.
     */
    async applyTrackingEvent(event: TrackingEvent): Promise<TrackingApplyDecision> {
      return withTransaction(payload, async (transactionID) => {
        const req = transactionReq(transactionID)

        // Lock first, before any state is read — a courier retrying a scan while the first delivery is
        // still in flight would otherwise let both pass the duplicate check.
        const lockedId = await lockOrderByNumber(payload, event.reference, transactionID)
        if (lockedId === null) {
          return { action: 'ignore', reason: 'reference_mismatch', courierStatus: event.courierStatus } as const
        }

        const order = (await payload.findByID({
          collection: 'orders',
          id: lockedId,
          depth: 0,
          overrideAccess: true,
          ...req,
        })) as Order | null

        if (order === null) {
          return { action: 'ignore', reason: 'reference_mismatch', courierStatus: event.courierStatus } as const
        }

        const { docs: events } = await payload.find({
          collection: 'orderEvents',
          where: { order: { equals: lockedId } } satisfies Where,
          depth: 0,
          pagination: false,
          overrideAccess: true,
          ...req,
        })

        const decision = decideTrackingApply({
          order: {
            orderNumber: order.orderNumber,
            status: order.status,
            awbCode: typeof order.awbCode === 'string' ? order.awbCode : null,
            // Tracking prefixes only. Asking for every id would let a payment event id make an
            // unrelated delivery scan look like a duplicate.
            processedEventIds: eventIdsFrom(
              events.map((row) => row.note),
              TRACKING_EVENT_ID_PREFIXES,
            ),
          },
          event,
        })

        if (decision.action === 'ignore') return decision

        // The only way status changes anywhere in this codebase. Carries the transaction, so the
        // status write, the audit row and this lock are one atomic unit.
        await orders.transition({
          orderId: lockedId,
          toStatus: decision.toStatus,
          source: 'webhook',
          note: decision.note,
          transactionID,
        })

        return decision
      })
    },
  }
}

export type PayloadShipping = ReturnType<typeof createPayloadShipping>
