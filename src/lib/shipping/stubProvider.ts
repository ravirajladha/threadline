/**
 * The stub courier.
 *
 * Per CLAUDE.md §2 "Build order — stub the outside world first": fulfilment is built and walkable
 * before a Shiprocket account exists. This class always books successfully, fabricates its AWBs, and
 * costs nothing.
 *
 * What it does **not** fake, exactly as `StubGateway` does not:
 *
 * - It signs its tracking callbacks with a real HMAC, so `verifyWebhook` genuinely verifies and the
 *   rejection path is exercised on every test run.
 * - Its events carry ids, so the idempotency logic has something real to deduplicate — and couriers
 *   replay scans far more freely than payment gateways, so this matters more here, not less.
 * - Its payloads have the same shape a real one will, so J11 is a new class plus a contract test.
 *
 * `simulateTracking` and `nextCourierStatus` are on the class and **not** on the interface, because a
 * real courier has neither. Nothing in the fulfilment flow can therefore come to depend on being
 * able to advance a parcel by asking.
 */
import { createHash, randomUUID } from 'node:crypto'

import { hmacSha256Hex, verifyHmacSignature } from '@/lib/payments/signature'
import { mapCourierStatus, normaliseCourierStatus } from './statusMap'
import type { Shipment, ShipmentRequest, ShippingProvider, TrackingEvent } from './types'
import type { OrderStatus } from '@/types'

/** The header a real provider uses. Kept identical so the route does not change at J11. */
export const SHIPPING_SIGNATURE_HEADER = 'x-shiprocket-signature'

/**
 * The happy path a parcel walks, in order.
 *
 * Used only by `nextCourierStatus`, to drive a local flow one step at a time. The courier strings are
 * the real Shiprocket ones so that `statusMap.ts` is exercised against the vocabulary it will
 * actually meet rather than against invented tokens.
 */
export const STUB_TRACKING_SEQUENCE: readonly string[] = Object.freeze([
  'PICKUP SCHEDULED',
  'PICKED UP',
  'IN TRANSIT',
  'OUT FOR DELIVERY',
  'DELIVERED',
])

export class StubShippingProvider implements ShippingProvider {
  readonly name = 'stub'

  private readonly secret: string
  private readonly now: () => Date
  private readonly newId: () => string

  /** Collaborators through the constructor — including the clock — so a test pins an exact payload. */
  constructor(options: { secret: string; now?: () => Date; newId?: () => string }) {
    if (options.secret.length === 0) {
      throw new Error(
        'StubShippingProvider needs a signing secret, so that signature verification is real',
      )
    }

    this.secret = options.secret
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => randomUUID())
  }

  createShipment(request: ShipmentRequest): Promise<Shipment> {
    // Every real courier validates the destination and refuses an empty parcel. Rejecting here means
    // the fulfilment flow handles those cases now rather than discovering them against a live
    // account, which is the entire point of stubbing rather than skipping.
    if (!/^[1-9][0-9]{5}$/.test(request.pincode)) {
      return Promise.reject(new Error(`Not a serviceable pincode: ${request.pincode}`))
    }

    if (request.parcelItems.length === 0) {
      return Promise.reject(new Error('A shipment must contain at least one item'))
    }

    if (!Number.isInteger(request.weightGrams) || request.weightGrams <= 0) {
      return Promise.reject(new Error(`A shipment needs a positive weight, received ${request.weightGrams}`))
    }

    return Promise.resolve({
      providerShipmentId: `stub_ship_${this.newId()}`,
      // Deterministic in the order number, so re-booking the same order in development yields the
      // same AWB instead of a new parcel every refresh. A real courier's AWB is likewise stable
      // once assigned.
      awbCode: stubAwbFor(request.reference),
      courier: 'Stub Express',
      labelUrl: null,
      createdAt: this.now().toISOString(),
    })
  }

  verifyWebhook(rawBody: string, signature: string | null): TrackingEvent | null {
    if (!verifyHmacSignature({ secret: this.secret, payload: rawBody, signature })) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return null
    }

    return toTrackingEvent(parsed)
  }

  // --- Development affordances, not part of the interface --------------------

  /**
   * The next scan after `current`, or null at the end of the sequence.
   *
   * Comparison is on the normalised form, so a caller may hand back whatever casing it stored.
   */
  nextCourierStatus(current: string | null): string | null {
    if (current === null) return STUB_TRACKING_SEQUENCE[0] ?? null

    const key = normaliseCourierStatus(current)
    const index = STUB_TRACKING_SEQUENCE.findIndex((entry) => normaliseCourierStatus(entry) === key)

    // An unrecognised current status restarts the sequence rather than dead-ending: this is a
    // development affordance, and being unable to advance a parcel is more annoying than useful.
    if (index === -1) return STUB_TRACKING_SEQUENCE[0] ?? null

    return STUB_TRACKING_SEQUENCE[index + 1] ?? null
  }

  /**
   * The scan in this sequence that corresponds to an order already at `status`, or null.
   *
   * The inverse of `statusMap`, but only over the stub's own sequence — a general reverse map would
   * be wrong, because several courier strings map to one status and there is no way to choose
   * between them. Searched from the end so the *latest* scan that produced this status wins, which
   * is the one the parcel is actually at.
   *
   * Lets a development flow ask "what happens next" from an order's status alone, instead of taking
   * the next scan from a caller — which would skip the sequence the stub exists to exercise.
   */
  currentCourierStatus(status: OrderStatus): string | null {
    for (let index = STUB_TRACKING_SEQUENCE.length - 1; index >= 0; index -= 1) {
      const entry = STUB_TRACKING_SEQUENCE[index]
      if (entry === undefined) continue

      const mapped = mapCourierStatus(entry)
      if (mapped.kind === 'status' && mapped.status === status) return entry
    }

    return null
  }

  /**
   * Build a signed tracking webhook, exactly as the provider would send it.
   *
   * Returns the raw body *and* its signature, because the raw bytes are what the signature covers —
   * handing back a parsed object would make the local flow pass a check production then fails.
   */
  simulateTracking(input: {
    reference: string
    awbCode: string
    courierStatus: string
    eventId?: string
    location?: string | null
  }): { body: string; signature: string; header: string; event: TrackingEvent } {
    const event: TrackingEvent = {
      id: input.eventId ?? `stub_trk_${this.newId()}`,
      awbCode: input.awbCode,
      reference: input.reference,
      courierStatus: input.courierStatus,
      occurredAt: this.now().toISOString(),
      location: input.location ?? 'Stub Hub',
    }

    const body = JSON.stringify(event)

    return {
      body,
      signature: hmacSha256Hex(this.secret, body),
      header: SHIPPING_SIGNATURE_HEADER,
      event,
    }
  }
}

/**
 * A stable, plausible AWB for an order number.
 *
 * Derived by hash rather than by counter so it needs no state and no database round trip, and
 * digits-only because that is what every courier's AWB looks like — a format that differs from the
 * real thing is a format that hides a parsing bug until J11.
 */
export function stubAwbFor(reference: string): string {
  const digest = createHash('sha256').update(reference, 'utf8').digest('hex')

  // 12 digits, which is the length Shiprocket's own AWBs run to.
  return (BigInt(`0x${digest.slice(0, 16)}`) % 1_000_000_000_000n).toString().padStart(12, '0')
}

/**
 * Narrow an unknown parsed body into a tracking event, or null.
 *
 * Every field is checked even though the signature already passed. A valid signature proves the body
 * came from the courier; it says nothing about the courier having sent the fields this version of the
 * code expects, and a missing `reference` should be a 400 rather than an `undefined` reaching a
 * database query (OWASP A08).
 */
export function toTrackingEvent(value: unknown): TrackingEvent | null {
  if (typeof value !== 'object' || value === null) return null

  const body = value as Record<string, unknown>

  const id = typeof body.id === 'string' && body.id.length > 0 ? body.id : null
  const awbCode = typeof body.awbCode === 'string' && body.awbCode.length > 0 ? body.awbCode : null
  const reference = typeof body.reference === 'string' && body.reference.length > 0 ? body.reference : null
  const courierStatus =
    typeof body.courierStatus === 'string' && body.courierStatus.trim().length > 0
      ? body.courierStatus
      : null

  if (id === null || awbCode === null || reference === null || courierStatus === null) return null

  return {
    id,
    awbCode,
    reference,
    courierStatus,
    occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : new Date(0).toISOString(),
    location: typeof body.location === 'string' ? body.location : null,
  }
}
