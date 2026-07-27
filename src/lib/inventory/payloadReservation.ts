/**
 * The Payload-backed `ReservationStore`.
 *
 * This is where the oversell guarantee actually lives, and one of only two places in the project
 * that drop below the Local API to raw SQL. That is a deliberate exception, so it is worth stating
 * why.
 *
 * A reservation has to answer "is there enough?" and "take it" as a **single indivisible step**.
 * Read-then-write through the Local API cannot: between the `find` and the `update`, another
 * checkout can take the last unit, and both requests believe they succeeded. The window is small
 * and it is exactly the window that matters, because it opens widest when stock is scarce — which
 * is when two people are most likely to be buying the same thing.
 *
 * One statement closes it:
 *
 *     UPDATE variants SET reserved_qty = reserved_qty + $qty
 *      WHERE id = $id AND stock_qty - reserved_qty >= $qty
 *
 * Postgres locks the row for the duration of the statement, so the condition is evaluated against
 * state no other transaction can be changing, and the increment is computed from the *current*
 * value rather than one read earlier. **Zero rows updated is the shortage** — there is no separate
 * check to fall out of step with the write.
 *
 * On SQL injection (OWASP A03): every value crosses as a bound parameter through drizzle's `sql`
 * template. Nothing here is built by string concatenation, and the only interpolations are the
 * quantities and ids, which arrive as parameters.
 *
 * The client lookup and the driver-shape helpers live in `lib/utils/drizzle.ts`, shared with the
 * order row locking that closes the same class of window around payment events.
 */
import { sql } from 'drizzle-orm'
import type { Payload, PayloadRequest } from 'payload'

import { drizzleClientFor, rowsAffected, rowsOf, toCount } from '@/lib/utils/drizzle'
import { numericId, optionalNumericId } from '@/lib/utils/ids'
import type { ReservationStore } from './reservationStore'
import type { VariantAvailability } from './reservation'

export interface PayloadReservationOptions {
  payload: Payload
  /** The open transaction, when there is one. Statements join it rather than racing it. */
  transactionID?: string | number | null
  /** Recorded on the stock movement so a sale can be traced to who or what caused it. */
  actor?: number | string | null
}

/**
 * Build the store.
 *
 * `recordSale` goes through the Local API rather than SQL, deliberately: writing a `stockMovements`
 * row fires `recalculateVariantStock`, which re-derives `stockQty` from the append-only ledger. The
 * ledger stays the single source of truth for how much stock exists, and this file only ever takes
 * the shortcut for `reservedQty` — a counter, not a ledger.
 */
export function createPayloadReservationStore(options: PayloadReservationOptions): ReservationStore {
  const { payload, transactionID = null, actor = null } = options
  const client = drizzleClientFor(payload, transactionID)
  const req: { req?: PayloadRequest } =
    transactionID === null ? {} : { req: { transactionID } as PayloadRequest }

  return {
    async readAvailability(variantIds): Promise<VariantAvailability[]> {
      if (variantIds.length === 0) return []

      const { docs } = await payload.find({
        collection: 'variants',
        where: { id: { in: variantIds.map((id) => id) } },
        depth: 0,
        pagination: false,
        overrideAccess: true,
        ...req,
      })

      return docs.map((doc) => ({
        variantId: doc.id,
        stockQty: typeof doc.stockQty === 'number' ? doc.stockQty : 0,
        reservedQty: typeof doc.reservedQty === 'number' ? doc.reservedQty : 0,
      }))
    },

    async holdOne(variantId, qty): Promise<boolean> {
      if (!Number.isInteger(qty) || qty < 1) {
        throw new RangeError(`A hold must be a whole number of at least 1 unit, received ${qty}`)
      }

      // The whole guarantee, in one statement. `COALESCE` because a variant that has never been
      // counted has a null rather than a zero, and null arithmetic would make the condition
      // unknown — which Postgres treats as false, silently refusing to sell anything.
      const result = await client.execute(sql`
        UPDATE variants
           SET reserved_qty = COALESCE(reserved_qty, 0) + ${qty}
         WHERE id = ${variantId}
           AND COALESCE(stock_qty, 0) - COALESCE(reserved_qty, 0) >= ${qty}
      `)

      return rowsAffected(result) > 0
    },

    async releaseOne(variantId, qty): Promise<void> {
      if (qty <= 0) return

      // `GREATEST(..., 0)` is the clamp: a double release must not drive the counter negative,
      // which would make the variant look like it had more available than physically exists.
      await client.execute(sql`
        UPDATE variants
           SET reserved_qty = GREATEST(COALESCE(reserved_qty, 0) - ${qty}, 0)
         WHERE id = ${variantId}
      `)
    },

    async recordSale(variantId, qty, orderId): Promise<void> {
      if (qty <= 0) return

      await payload.create({
        collection: 'stockMovements',
        data: {
          variant: numericId(variantId),
          type: 'out',
          qty,
          // Never any customer detail here — the order number is enough to trace it (OWASP A09).
          reason: `Sold on order ${orderId}`,
          order: numericId(orderId),
          ...(actor === null ? {} : { actor: optionalNumericId(actor) }),
        },
        depth: 0,
        overrideAccess: true,
        ...req,
      })
    },
  }
}

/**
 * Read `reservedQty` for one variant. Used by tests and by the scheduler's sweep.
 *
 * Goes through SQL rather than the Local API so it reads the same column the holds write, without
 * a document hydration in between.
 */
export async function readReservedQty(
  payload: Payload,
  variantId: number | string,
  transactionID: string | number | null = null,
): Promise<number> {
  const result = await drizzleClientFor(payload, transactionID).execute(sql`
    SELECT COALESCE(reserved_qty, 0) AS reserved_qty FROM variants WHERE id = ${variantId}
  `)

  const row = rowsOf(result)[0]

  return row === undefined ? 0 : toCount(row.reserved_qty)
}
