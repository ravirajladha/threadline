/**
 * The Payload-backed returns port — raising one, and moving it through its life.
 *
 * Three guarantees, each of which is somewhere this costs real money if it is wrong.
 *
 * **Ownership is proved through the order, in one query.** `returns` has no `customer` column;
 * a return belongs to whoever owns the order it names. So raising one matches the order number
 * *and* the session's customer id together, exactly as `accountOrders.find` does — and for the same
 * reason, since an order number is printed on emails and is trivially walked. The J8 security pass
 * found the collection's own `create` rule let a customer POST a return against a stranger's order
 * id entirely outside this port; that is now `staffWrite`, and this is the only customer path in.
 *
 * **Stock comes back at `received`, and nowhere else.** Not when the courier collects it, not when
 * the customer says they posted it — after somebody has looked at the garment. Same rule J5 stated
 * when it refused to credit stock on a tracking event, and the reason is the same: a parcel moving
 * is not a garment being sellable.
 *
 * **An exchange holds its replacement at `approved`.** The reservation goes through the same store
 * a checkout uses, so an exchange and a sale compete for the last medium on equal terms — and the
 * approval fails rather than promising a size that is already spoken for. Rejecting an approved
 * exchange releases the hold; forgetting that is how stock leaks away a unit at a time.
 */
import type { Payload, Where } from 'payload'

import { canWrite, customerIdOf, staffIdOf, staffRoleOf } from '@/access'
import { createPayloadReservationStore } from '@/lib/inventory/payloadReservation'
import { holdReservation, releaseReservation } from '@/lib/inventory/reservationStore'
// The pure half, deliberately: importing the loader would pull `@payload-config` into a module
// that `collections/Returns.ts` imports, closing a cycle. See `settings/mappers.ts`.
import { returnWindowDays } from '@/lib/settings/mappers'
import { numericId, relationshipId } from '@/lib/utils/ids'
import { transactionReq, withTransaction } from '@/lib/utils/transaction'
import type { Order, OrderItem, Return, Variant } from '@/payload-types'
import {
  checkReturnRequest,
  evaluateReturnEligibility,
  type ReturnableLine,
  type ReturnRequestRefusal,
} from './eligibility'
import { decideExchange, type ExchangeRefusal } from './exchange'
import { assertReturnTransition, STOCK_RESTORED_AT } from './transitions'
// `ReturnType` is aliased because the domain union collides with TypeScript's built-in
// `ReturnType<T>`, which this file uses at the bottom. Renaming the import rather than the union
// keeps `@/types` reading the way the schema does.
import type { ReturnStatus, ReturnType as ReturnKind } from '@/types'

/** A line as the customer submitted it. Quantities are input and are checked, not trusted. */
export interface RequestedReturnLine {
  orderItemId: number
  qty: number
  reason: string
}

export type ReturnFailure =
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'ineligible'; refusal: ReturnRequestRefusal }
  | { ok: false; reason: 'exchange_refused'; refusal: ExchangeRefusal }
  | { ok: false; reason: 'illegal_transition'; from: ReturnStatus; to: ReturnStatus }

export type RaiseReturnResult = { ok: true; id: number; status: ReturnStatus } | ReturnFailure
export type ReturnTransitionResult = { ok: true; status: ReturnStatus } | ReturnFailure

export function createPayloadReturns(options: { payload: Payload }) {
  const { payload } = options

  /**
   * The order behind a return, if this caller owns it.
   *
   * Both conditions in the query, never one here and one in a branch: the database returning
   * nothing is a stronger guarantee than code choosing to ignore what it got.
   */
  async function ownedOrder(
    orderNumber: string,
    user: unknown,
    transactionID: string | number | null,
  ): Promise<Order | null> {
    const customerId = customerIdOf(user)
    if (customerId === null) return null

    const { docs } = await payload.find({
      collection: 'orders',
      where: {
        and: [{ orderNumber: { equals: orderNumber } }, { customer: { equals: numericId(customerId) } }],
      } satisfies Where,
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: true,
      ...transactionReq(transactionID),
    })

    return (docs[0] as Order | undefined) ?? null
  }

  /**
   * How many of each line are already inside a return.
   *
   * Counted from the returns themselves rather than a column on `orderItems`, so there is one record
   * of what has been sent back instead of two that can disagree — the same argument as reading
   * processed event ids out of the audit trail in J5. Rejected returns do not count: a refused
   * request has not consumed anything.
   */
  async function alreadyReturnedByItem(
    orderId: number,
    transactionID: string | number | null,
  ): Promise<Map<number, number>> {
    const { docs } = await payload.find({
      collection: 'returns',
      where: {
        and: [{ order: { equals: orderId } }, { status: { not_equals: 'rejected' } }],
      } satisfies Where,
      depth: 0,
      pagination: false,
      overrideAccess: true,
      ...transactionReq(transactionID),
    })

    const counts = new Map<number, number>()

    for (const row of docs as Return[]) {
      for (const item of row.items ?? []) {
        const id = relationshipId(item.orderItem)
        if (id === null) continue

        counts.set(id, (counts.get(id) ?? 0) + item.qty)
      }
    }

    return counts
  }

  /** The variants and quantities an exchange has reserved, for holding or releasing. */
  function exchangeReservation(row: Return): { variantId: number; qty: number } | null {
    if (row.type !== 'exchange') return null

    const variantId = relationshipId(row.exchangeVariant)
    if (variantId === null) return null

    const qty = (row.items ?? []).reduce((total, item) => total + item.qty, 0)

    return qty > 0 ? { variantId, qty } : null
  }

  return {
    /**
     * Raise a return or an exchange.
     *
     * Everything about what may be sent back is decided by the pure layer; this reads the facts,
     * asks it, and writes the row. An exchange is validated here but **not** reserved — the hold
     * happens at approval, so an unapproved request cannot sit on stock indefinitely.
     */
    async raise(input: {
      user: unknown
      orderNumber: string
      type: ReturnKind
      lines: readonly RequestedReturnLine[]
      exchangeVariantId?: number | null
      customerNote?: string
      now?: Date
    }): Promise<RaiseReturnResult> {
      const {
        user,
        orderNumber,
        type,
        lines,
        exchangeVariantId = null,
        customerNote,
        now = new Date(),
      } = input

      if (customerIdOf(user) === null) return { ok: false, reason: 'forbidden' }

      return withTransaction(payload, async (transactionID) => {
        const req = transactionReq(transactionID)

        const order = await ownedOrder(orderNumber, user, transactionID)
        // Not theirs and does not exist are one answer.
        if (order === null) return { ok: false, reason: 'not_found' } as const

        const { docs: items } = await payload.find({
          collection: 'orderItems',
          where: { order: { equals: order.id } } satisfies Where,
          depth: 0,
          pagination: false,
          overrideAccess: true,
          ...req,
        })

        const returned = await alreadyReturnedByItem(order.id, transactionID)

        const returnable: ReturnableLine[] = (items as OrderItem[]).map((item) => ({
          orderItemId: item.id,
          sku: item.sku,
          productTitle: item.productTitle,
          sizeLabel: item.sizeLabel,
          colourName: item.colourName,
          qty: item.qty,
          alreadyReturned: returned.get(item.id) ?? 0,
        }))

        const settings = await payload.findGlobal({ slug: 'settings', depth: 0, overrideAccess: true })

        const eligibility = evaluateReturnEligibility({
          order: { status: order.status, deliveredAt: typeof order.deliveredAt === 'string' ? order.deliveredAt : null },
          lines: returnable,
          windowDays: returnWindowDays(settings),
          now,
        })

        const checked = checkReturnRequest({
          eligibility,
          requested: lines.map((line) => ({ orderItemId: line.orderItemId, qty: line.qty })),
        })

        if (!checked.ok) return { ok: false, reason: 'ineligible', refusal: checked.refusal } as const

        // An exchange is validated now so the customer hears "that size is gone" while they are
        // still on the page and can choose another — even though the hold itself waits for approval.
        if (type === 'exchange') {
          const check = await validateExchange({
            payload,
            transactionID,
            orderItems: items as OrderItem[],
            lines: checked.lines,
            exchangeVariantId,
          })

          if (!check.ok) return { ok: false, reason: 'exchange_refused', refusal: check.refusal } as const
        }

        const created = (await payload.create({
          collection: 'returns',
          data: {
            order: order.id,
            type,
            status: 'requested',
            items: checked.lines.map((line) => ({
              orderItem: line.orderItemId,
              qty: line.qty,
              reason: (lines.find((entry) => entry.orderItemId === line.orderItemId)?.reason ??
                'changed_mind') as Return['items'][number]['reason'],
            })),
            ...(type === 'exchange' && exchangeVariantId !== null
              ? { exchangeVariant: exchangeVariantId }
              : {}),
            ...(customerNote === undefined ? {} : { customerNote }),
          },
          depth: 0,
          overrideAccess: true,
          ...req,
        })) as Return

        // Order number and type. No address, no note — the note is the customer's own words.
        payload.logger.info({ orderNumber: order.orderNumber, type }, 'Return raised')

        return { ok: true, id: created.id, status: 'requested' as ReturnStatus }
      })
    },

    /**
     * Move a return, applying whatever that status means.
     *
     * Staff only, and validated by the machine before anything is written — `assertReturnTransition`
     * throws, which this converts into a typed refusal, because an agent clicking a stale button is
     * an ordinary event rather than an exceptional one.
     */
    async transition(input: {
      user: unknown
      returnId: number | string
      toStatus: ReturnStatus
      refundAmount?: number
      adminNote?: string
    }): Promise<ReturnTransitionResult> {
      const { user, returnId, toStatus, refundAmount, adminNote } = input

      if (!canWrite(staffRoleOf(user), 'refunds')) return { ok: false, reason: 'forbidden' }

      return withTransaction(payload, async (transactionID) => {
        const req = transactionReq(transactionID)
        const id = numericId(returnId)

        const row = (await payload
          .findByID({ collection: 'returns', id, depth: 0, overrideAccess: true, ...req })
          .catch(() => null)) as Return | null

        if (row === null) return { ok: false, reason: 'not_found' } as const

        try {
          assertReturnTransition(row.status, toStatus)
        } catch {
          return { ok: false, reason: 'illegal_transition', from: row.status, to: toStatus } as const
        }

        const store = createPayloadReservationStore({ payload, transactionID })
        const reservation = exchangeReservation(row)

        // Approving an exchange takes the hold. It competes with checkout for the same units, so a
        // shortage refuses the approval rather than promising a size somebody else has already
        // claimed.
        if (toStatus === 'approved' && reservation !== null) {
          const hold = await holdReservation(store, [reservation])

          if (!hold.ok) {
            const shortage = hold.shortages[0]

            return {
              ok: false,
              reason: 'exchange_refused',
              refusal: { reason: 'insufficient_stock', available: shortage?.available ?? 0 },
            } as const
          }
        }

        // Rejecting an approved exchange gives the hold back. Without this, stock leaks a unit at a
        // time and nothing anywhere says why.
        if (toStatus === 'rejected' && reservation !== null && row.status !== 'requested') {
          await releaseReservation(store, [reservation])
        }

        if (toStatus === STOCK_RESTORED_AT) {
          await restoreStock({ payload, transactionID, row, actor: staffIdOf(user) })
        }

        await payload.update({
          collection: 'returns',
          id,
          data: {
            status: toStatus,
            ...(refundAmount === undefined ? {} : { refundAmount }),
            ...(adminNote === undefined ? {} : { adminNote }),
          },
          depth: 0,
          overrideAccess: true,
          ...req,
        })

        payload.logger.info(
          { returnId: id, from: row.status, to: toStatus, actor: staffIdOf(user) ?? 'unknown' },
          'Return status changed',
        )

        return { ok: true, status: toStatus }
      })
    },

    /** A customer's returns for one order. Scoped through the order, like everything else here. */
    async listForOrder(orderNumber: string, user: unknown): Promise<Return[]> {
      const order = await ownedOrder(orderNumber, user, null)
      if (order === null) return []

      const { docs } = await payload.find({
        collection: 'returns',
        where: { order: { equals: order.id } } satisfies Where,
        sort: '-createdAt',
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })

      return docs as Return[]
    },
  }
}

/**
 * Check an exchange against the replacement variant.
 *
 * Split out because `raise` and a future admin path both need it, and because it is the one part of
 * raising that talks to two collections.
 */
async function validateExchange(input: {
  payload: Payload
  transactionID: string | number | null
  orderItems: readonly OrderItem[]
  lines: ReadonlyArray<{ orderItemId: number; qty: number }>
  exchangeVariantId: number | null
}): Promise<{ ok: true } | { ok: false; refusal: ExchangeRefusal }> {
  const { payload, transactionID, orderItems, lines, exchangeVariantId } = input

  if (exchangeVariantId === null) return { ok: false, refusal: { reason: 'unavailable' } }

  const first = lines[0]
  if (first === undefined) return { ok: false, refusal: { reason: 'unavailable' } }

  const sourceItem = orderItems.find((item) => item.id === first.orderItemId)
  const fromVariantId = sourceItem === undefined ? null : relationshipId(sourceItem.variant)

  if (fromVariantId === null) return { ok: false, refusal: { reason: 'unavailable' } }

  const req = transactionReq(transactionID)

  const [source, replacement] = (await Promise.all([
    payload
      .findByID({ collection: 'variants', id: fromVariantId, depth: 0, overrideAccess: true, ...req })
      .catch(() => null),
    payload
      .findByID({ collection: 'variants', id: exchangeVariantId, depth: 0, overrideAccess: true, ...req })
      .catch(() => null),
  ])) as [Variant | null, Variant | null]

  const fromProductId = source === null ? null : relationshipId(source.product)
  if (fromProductId === null) return { ok: false, refusal: { reason: 'unavailable' } }

  const decision = decideExchange({
    request: {
      orderItemId: first.orderItemId,
      fromVariantId,
      toVariantId: exchangeVariantId,
      qty: lines.reduce((total, line) => total + line.qty, 0),
    },
    fromProductId,
    replacement:
      replacement === null
        ? null
        : {
            id: replacement.id,
            productId: relationshipId(replacement.product) ?? -1,
            isActive: replacement.isActive !== false,
            available: Math.max(0, (replacement.stockQty ?? 0) - (replacement.reservedQty ?? 0)),
          },
  })

  return decision.ok ? { ok: true } : { ok: false, refusal: decision.refusal }
}

/**
 * Put the returned units back on the shelf.
 *
 * Through the ledger, never by writing `stockQty`: the cached figure is recomputed from movements
 * by the collection hook, which is what keeps the number and its history in step (J1's rule, and
 * the reason `stockQty` is read-only everywhere).
 */
async function restoreStock(input: {
  payload: Payload
  transactionID: string | number | null
  row: Return
  actor: number | string | null
}): Promise<void> {
  const { payload, transactionID, row, actor } = input
  const req = transactionReq(transactionID)

  for (const item of row.items ?? []) {
    const orderItemId = relationshipId(item.orderItem)
    if (orderItemId === null) continue

    const orderItem = (await payload
      .findByID({ collection: 'orderItems', id: orderItemId, depth: 0, overrideAccess: true, ...req })
      .catch(() => null)) as OrderItem | null

    const variantId = orderItem === null ? null : relationshipId(orderItem.variant)
    if (variantId === null) continue

    await payload.create({
      collection: 'stockMovements',
      data: {
        variant: variantId,
        type: 'return',
        qty: item.qty,
        reason: `Return received`,
        actor,
      } as never,
      depth: 0,
      overrideAccess: true,
      ...req,
    })
  }
}

export type PayloadReturns = ReturnType<typeof createPayloadReturns>
