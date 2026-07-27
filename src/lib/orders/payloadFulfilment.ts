/**
 * The staff-facing fulfilment port — pack, ship, mark delivered, and book a courier.
 *
 * `fulfilment.ts` decides *whether* an action is allowed; this decides nothing. It is the reading
 * and the writing around that decision, and it exists to hold three properties that a call site
 * would otherwise have to remember one at a time.
 *
 * **The role is re-checked here, not only in the admin UI.** Payload applies collection access to
 * its own CRUD routes; a custom endpoint or a server action reaches this module directly and gets
 * none of it. So permission is the first thing checked, for the same reason `endpoints/guards.ts`
 * exists (OWASP A01). It is checked *before the order is read*, so a caller who may not fulfil
 * orders cannot learn from the difference between "forbidden" and "no such order" whether an id
 * exists at all.
 *
 * **The state the decision runs on is re-read under the row lock.** The admin screen's copy of the
 * order is a snapshot from whenever it rendered — possibly before the courier's webhook marked the
 * parcel delivered. Deciding on what the client sent back would let a stale page drive a transition
 * the order no longer allows (OWASP A04).
 *
 * **Status is written only by `payloadOrders.transition`.** Never directly. That is what guarantees
 * the jump is validated and an `orderEvents` row is appended, and it inherits J4's row lock; the
 * transition joins *this* transaction rather than opening a second one that would wait on our lock
 * and deadlock against it.
 */
import type { Payload } from 'payload'

import { canWrite, staffIdOf, staffRoleOf } from '@/access'
import type { Order } from '@/payload-types'
import type { BookShipmentResult, PayloadShipping } from '@/lib/shipping/payloadShipping'
import { numericId } from '@/lib/utils/ids'
import { transactionReq, withTransaction } from '@/lib/utils/transaction'
import {
  describeRefusal,
  evaluateFulfilment,
  fulfilmentOptions,
  type FulfilmentAction,
  type FulfilmentDecision,
  type FulfilmentRefusal,
  type FulfilmentState,
} from './fulfilment'
import { createPayloadOrders, lockOrderById } from './payloadOrders'
import type { OrderStatus } from '@/types'

/**
 * The fulfilment-relevant slice of an order document.
 *
 * Exported because the admin view needs the same reduction to render its buttons, and two places
 * deriving "is this order shippable" from a document is exactly the drift `fulfilment.ts` was
 * written to prevent (CLAUDE.md §3 — second use, one function).
 */
export function fulfilmentStateOf(order: Order): FulfilmentState {
  return {
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    // Normalised to null here so `evaluateFulfilment` never has to care that Payload spells an
    // absent optional string as `undefined` in one place and `null` in another.
    awbCode: typeof order.awbCode === 'string' && order.awbCode.trim().length > 0 ? order.awbCode : null,
  }
}

/** Every action and its verdict, for an order document the caller already has. */
export function fulfilmentOptionsFor(order: Order): FulfilmentDecision[] {
  return fulfilmentOptions(fulfilmentStateOf(order))
}

export type FulfilmentOutcome =
  | { ok: true; action: FulfilmentAction; orderNumber: string; toStatus: OrderStatus }
  /** Not staff, or a role without write on orders. Never says which. */
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  /** The order exists and the caller may act, but the action is not available on it. */
  | { ok: false; reason: 'refused'; refusal: FulfilmentRefusal; message: string }

export type BookShipmentOutcome = BookShipmentResult | { ok: false; reason: 'forbidden' }

export interface PayloadFulfilmentOptions {
  payload: Payload
  /** Injected rather than constructed, so a test supplies a double and no HTTP call is made. */
  shipping: PayloadShipping
}

export function createPayloadFulfilment(options: PayloadFulfilmentOptions) {
  const { payload, shipping } = options
  const orders = createPayloadOrders({ payload })

  /**
   * May this caller fulfil orders?
   *
   * `orders` is the resource, so `order_manager` and `super_admin` pass and `support_agent` —
   * who can read an order to answer a customer — does not. The refusal is logged with the user id
   * but no order detail: a denied attempt is worth an audit line, and the line should not contain
   * anything the caller was refused access to (OWASP A09).
   */
  function denyUnlessFulfiller(user: unknown, action: string): boolean {
    if (canWrite(staffRoleOf(user), 'orders')) return true

    payload.logger.warn(
      { action, user: staffIdOf(user) ?? 'anonymous' },
      'Denied fulfilment action',
    )

    return false
  }

  return {
    /**
     * Perform one fulfilment action on one order.
     *
     * The whole sequence — lock, read, decide, transition — is a single transaction. Two staff
     * members clicking "Ship" at the same moment are ordered by the lock, so the second reads the
     * status the first wrote and is refused with `illegal_transition` rather than writing a second
     * audit row for a move that only looked legal against a stale read.
     */
    async perform(input: {
      orderId: number | string
      action: FulfilmentAction
      /** The raw `req.user`. Narrowed here, so no caller can pass a role it decided on itself. */
      user: unknown
      note?: string
    }): Promise<FulfilmentOutcome> {
      const { orderId, action, user, note } = input

      if (!denyUnlessFulfiller(user, action)) return { ok: false, reason: 'forbidden' }

      const id = numericId(orderId)
      const actor = staffIdOf(user)

      return withTransaction(payload, async (transactionID) => {
        await lockOrderById(payload, id, transactionID)

        const order = (await payload.findByID({
          collection: 'orders',
          id,
          depth: 0,
          overrideAccess: true,
          ...transactionReq(transactionID),
        })) as Order | null

        if (order === null) return { ok: false, reason: 'not_found' } as const

        const decision = evaluateFulfilment(fulfilmentStateOf(order), action)

        if (!decision.allowed) {
          const { allowed: _allowed, action: _action, ...refusal } = decision

          return {
            ok: false,
            reason: 'refused',
            refusal,
            message: describeRefusal(refusal),
          } as const
        }

        // Carries the transaction, so the status write and its audit row join this lock rather than
        // contending with it. `transition` re-locks the same row inside the same transaction, which
        // Postgres grants immediately — a lock is re-entrant within one transaction.
        await orders.transition({
          orderId: id,
          toStatus: decision.toStatus,
          source: 'staff',
          actor,
          ...(note === undefined ? {} : { note }),
          transactionID,
        })

        payload.logger.info(
          { orderNumber: order.orderNumber, action, toStatus: decision.toStatus, actor: actor ?? 'unknown' },
          'Fulfilment action applied',
        )

        return {
          ok: true,
          action,
          orderNumber: order.orderNumber,
          toStatus: decision.toStatus,
        } as const
      })
    },

    /**
     * Ask the courier for a parcel, on behalf of a staff member.
     *
     * Booking is not a status change, so it does not go through `perform` — an order stays
     * `confirmed` or `packed` while it acquires an AWB. What it shares is the permission check,
     * which is the reason it lives here at all rather than being called straight off
     * `payloadShipping`: that port is the mechanism and has no notion of who is asking.
     */
    async bookShipment(input: { orderId: number | string; user: unknown }): Promise<BookShipmentOutcome> {
      const { orderId, user } = input

      if (!denyUnlessFulfiller(user, 'book')) return { ok: false, reason: 'forbidden' }

      return shipping.bookShipment(orderId)
    },
  }
}

export type PayloadFulfilment = ReturnType<typeof createPayloadFulfilment>
