/**
 * Translating a courier's vocabulary into ours.
 *
 * This file exists because couriers do not speak in order statuses. They emit scans — "PICKED UP",
 * "Out For Delivery", "RTO INITIATED", "Undelivered" — in inconsistent casing, with inconsistent
 * punctuation, and they add new ones without telling anyone. Somewhere that has to become one of
 * our eleven `OrderStatus` values, and the only safe place for it is a table that can be read and
 * tested rather than a chain of `includes()` calls inside a webhook handler.
 *
 * **An unrecognised status is never guessed at.** The temptation is a fallback — "if it contains
 * 'deliver' it is delivered" — and that is precisely how an *undelivered* parcel gets marked
 * delivered, which closes the order, releases the stock and stops the customer being chased. So an
 * unknown code returns `{ kind: 'unknown' }` and the caller logs it and changes nothing.
 *
 * **Recognised-but-informational is a distinct answer.** A pickup being scheduled, a delivery
 * attempt failing, an address query — all real events, none of which move an order. They return
 * `{ kind: 'no_change' }`, so a monitoring dashboard can tell the difference between "the courier
 * said something we ignore on purpose" and "the courier said something we do not understand".
 * Collapsing both into null is how an integration drifts silently after a provider renames a code.
 *
 * The mapping is intentionally *many-to-one* and lossy in one direction only: several courier codes
 * map to `shipped`, because everything between pickup and the final mile is, to a customer waiting
 * at home, the same fact.
 */
import type { OrderStatus } from '@/types'
import type { MappedCourierStatus } from './types'

/**
 * Normalise a courier's status string for lookup.
 *
 * Lowercased, punctuation and runs of whitespace collapsed to single underscores, edges trimmed.
 * `"RTO   Initiated"`, `"rto-initiated"` and `"RTO_INITIATED"` are the same key, because they are
 * the same event and a table that needed a row for each spelling would be wrong the first time a
 * provider changed its formatting.
 */
export function normaliseCourierStatus(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Courier status → the order status it implies.
 *
 * Keys are normalised. Covers the Shiprocket vocabulary, which is what J11 connects, plus the
 * common synonyms other couriers use for the same scans — building the table around one provider's
 * exact strings would mean rewriting it rather than extending it.
 */
export const COURIER_STATUS_MAP: Readonly<Record<string, OrderStatus>> = Object.freeze({
  // Everything from pickup to the final mile is "shipped" as far as an order is concerned.
  picked_up: 'shipped',
  pickup_complete: 'shipped',
  shipped: 'shipped',
  in_transit: 'shipped',
  reached_destination_hub: 'shipped',
  reached_warehouse: 'shipped',

  out_for_delivery: 'out_for_delivery',
  out_for_pickup_delivery: 'out_for_delivery',

  delivered: 'delivered',

  // Return to origin. Every stage of it is `rto` — the parcel is coming back and the order's next
  // move is a refund whichever leg it is currently on.
  rto: 'rto',
  rto_initiated: 'rto',
  rto_in_transit: 'rto',
  rto_delivered: 'rto',
  rto_acknowledged: 'rto',

  cancelled: 'cancelled',
  canceled: 'cancelled',
})

/**
 * Recognised statuses that deliberately move nothing.
 *
 * `undelivered` is the important one and the reason this set exists rather than being folded into
 * the unknown case. A failed delivery attempt is normal — the courier will try again tomorrow — and
 * the order should stay exactly where it is. Mapping it to anything, or treating it as unrecognised
 * noise, both lose that.
 */
export const INFORMATIONAL_COURIER_STATUSES: ReadonlySet<string> = Object.freeze(
  new Set([
    'pickup_scheduled',
    'pickup_generated',
    'pickup_queued',
    'pickup_rescheduled',
    'awb_assigned',
    'label_generated',
    'manifest_generated',
    'undelivered',
    'delivery_attempted',
    'address_query',
    'consignee_unavailable',
    'in_flight',
    'custom_clearance',
  ]),
)

/**
 * What this courier status means for the order.
 *
 * Pure and total: every string gets an answer, and an empty or whitespace-only status is `unknown`
 * rather than a lookup on the empty key — a courier sending a blank status is a malformed event, not
 * an informational one.
 */
export function mapCourierStatus(courierStatus: string): MappedCourierStatus {
  const key = normaliseCourierStatus(courierStatus)

  if (key.length === 0) return { kind: 'unknown', courierStatus }

  const status = COURIER_STATUS_MAP[key]
  if (status !== undefined) return { kind: 'status', status }

  if (INFORMATIONAL_COURIER_STATUSES.has(key)) return { kind: 'no_change', courierStatus }

  return { kind: 'unknown', courierStatus }
}
