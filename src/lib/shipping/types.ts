/**
 * The shipping contract.
 *
 * `ShippingProvider` is the interface; `StubShippingProvider` and, at J11, `ShiprocketProvider`
 * implement it. Nothing in the fulfilment flow imports a provider — it asks the factory for one and
 * depends only on what is declared here, so swapping couriers is one new class and a contract test.
 *
 * As with `payments/types.ts`, the interface is shaped around what actually has to be trusted,
 * which is the part a stub does not get to fake:
 *
 * - `createShipment` is a request to the courier and may well be fabricated.
 * - `verifyWebhook` is the **security boundary**. A tracking callback is how an order becomes
 *   `delivered`, and an unsigned one is not a courier, whoever sent it (OWASP A08).
 * - Every event carries a provider `id`, which is the idempotency key. Couriers retry and replay
 *   scans freely — far more than payment gateways do, because a parcel generates many events and
 *   their delivery is best-effort.
 */
import type { OrderStatus } from '@/types'

/** What the courier needs to book a parcel. Assembled server-side from the order. */
export interface ShipmentRequest {
  /** Our order number, echoed back on every tracking event so an event maps to an order. */
  reference: string
  /** Destination pincode only — a courier needs the full address, the *booking decision* does not. */
  pincode: string
  weightGrams: number
  /** Paise to collect on delivery. Zero for a prepaid order. */
  codAmountPaise: number
  /** Line count and total units, for choosing a service. No customer detail. */
  parcelItems: readonly { sku: string; qty: number }[]
}

/** A booked parcel. */
export interface Shipment {
  /** The courier's own handle for the shipment. */
  providerShipmentId: string
  /** Air waybill — the tracking number the customer quotes. */
  awbCode: string
  /** Which courier actually took it, which a marketplace provider only decides at booking time. */
  courier: string
  /**
   * The shipping label, if the provider gave us one.
   *
   * **Never fetched server-side** (OWASP A10). This is a provider-supplied URL, so treating it as
   * something to `fetch` would be handing an outside system our network position. It is stored and
   * handed to staff to open in their own browser, and nothing else.
   */
  labelUrl: string | null
  createdAt: string
}

/**
 * One scan in a parcel's history.
 *
 * `courierStatus` is deliberately the courier's **own** unnormalised text rather than one of our
 * statuses. Normalising at the edge of the type would mean the mapping happened somewhere
 * un-testable, and it would throw away the original string that a support conversation actually
 * needs. `statusMap.ts` does the translation, visibly and by table.
 */
export interface TrackingEvent {
  /** The provider's event id. The idempotency key — nothing else identifies a replayed scan. */
  id: string
  awbCode: string
  /** Our order number. */
  reference: string
  courierStatus: string
  occurredAt: string
  /**
   * Where the scan happened, as the courier reports it — typically a city or a hub name.
   *
   * Safe to log and to show the customer. It is the courier's own location, never the customer's
   * address, and the distinction is why this field is not called `address` (OWASP A09).
   */
  location: string | null
}

/**
 * What a courier status means for our order.
 *
 * Three outcomes rather than a nullable status, because "we do not recognise this code" and "this
 * code is recognised and means nothing changed" are different facts and want different handling.
 * Collapsing them into `null` is how an integration silently drifts: the courier renames a status,
 * every event starts being ignored, and nothing anywhere says so.
 */
export type MappedCourierStatus =
  | { kind: 'status'; status: OrderStatus }
  /** Recognised, but purely informational — a pickup being scheduled moves no order. */
  | { kind: 'no_change'; courierStatus: string }
  /** Not in the table at all. Worth logging as a warning; never guessed at. */
  | { kind: 'unknown'; courierStatus: string }

export interface ShippingProvider {
  /** Recorded on the order event, so a support query can tell which integration booked a parcel. */
  readonly name: string

  createShipment(request: ShipmentRequest): Promise<Shipment>

  /**
   * Verify and parse a tracking webhook.
   *
   * Takes the **raw** body string for the same reason the payment gateway does: a signature covers
   * the exact bytes sent, and `JSON.parse` followed by `JSON.stringify` does not reproduce them.
   * Returns null for anything that fails verification or does not parse, and the caller answers 400
   * without saying which of the two it was.
   */
  verifyWebhook(rawBody: string, signature: string | null): TrackingEvent | null
}
