/**
 * Shipments that have gone quiet.
 *
 * **This job does not poll the courier, and that is deliberate.** `ShippingProvider` has no
 * "fetch tracking" method: the stub's `simulateTracking` is on the class and off the interface
 * precisely so that nothing in fulfilment can come to depend on being able to advance a parcel by
 * asking, because a webhook-only courier cannot answer. Adding polling here would quietly reverse
 * that decision.
 *
 * What it does instead is the thing tracking webhooks cannot do for themselves: **notice silence.**
 * A missed webhook has no failure signature — no error, no retry, nothing in a log. The order simply
 * sits at `shipped` for ever while the customer waits. So the job looks for parcels whose last
 * recorded movement is older than they should be and reports them, in counts and one warning line
 * per order, for a human to chase with the courier.
 *
 * The counts are the point. "3 shipments stale" every morning is a number the owner watches; a job
 * that returns "ok" is a job nobody notices has stopped working.
 */
import type { Payload, Where } from 'payload'

import { relationshipId } from '@/lib/utils/ids'
import type { OrderStatus } from '@/types'
import type { Job, JobContext, JobCounts } from '../types'

/** Statuses where a parcel is in a courier's hands and further scans are expected. */
export const IN_FLIGHT_STATUSES: readonly OrderStatus[] = Object.freeze(['shipped', 'out_for_delivery'])

export interface StatusSyncRules {
  /** How long a parcel may go without a scan before somebody should look at it. */
  staleHours: number
}

/** Two days. Long enough to cover a weekend, short enough that a lost parcel surfaces in the week. */
export const STATUS_SYNC_RULES: StatusSyncRules = Object.freeze({ staleHours: 48 })

/** Just enough of a shipment to decide. */
export interface TrackedShipment {
  orderNumber: string
  status: OrderStatus
  awbCode: string | null
  /** When the order last moved. ISO, or null if it somehow has no history at all. */
  lastMovedAt: string | null
}

export type ShipmentSkip = 'not_in_flight' | 'no_awb' | 'recently_moved'

export type ShipmentSyncDecision =
  | { stale: true; shipment: TrackedShipment; quietHours: number }
  | { stale: false; shipment: TrackedShipment; reason: ShipmentSkip }

const HOUR_MS = 3_600_000

export function decideShipmentStale(
  shipment: TrackedShipment,
  now: Date,
  rules: StatusSyncRules = STATUS_SYNC_RULES,
): ShipmentSyncDecision {
  if (!IN_FLIGHT_STATUSES.includes(shipment.status)) {
    return { stale: false, shipment, reason: 'not_in_flight' }
  }

  if (shipment.awbCode === null || shipment.awbCode.trim().length === 0) {
    return { stale: false, shipment, reason: 'no_awb' }
  }

  const movedAt = shipment.lastMovedAt === null ? NaN : Date.parse(shipment.lastMovedAt)

  // No parsable history on an in-flight parcel is *itself* the alarm — an order that reached
  // `shipped` without an audit row is a bug, and reporting it as fine would hide it.
  const quietMs = Number.isNaN(movedAt) ? Number.POSITIVE_INFINITY : now.getTime() - movedAt

  if (quietMs < rules.staleHours * HOUR_MS) return { stale: false, shipment, reason: 'recently_moved' }

  return { stale: true, shipment, quietHours: Number.isFinite(quietMs) ? Math.floor(quietMs / HOUR_MS) : -1 }
}

export interface StatusSyncSelection {
  stale: Array<{ shipment: TrackedShipment; quietHours: number }>
  skipped: Record<ShipmentSkip, number>
}

export function selectStaleShipments(
  shipments: readonly TrackedShipment[],
  now: Date,
  rules: StatusSyncRules = STATUS_SYNC_RULES,
): StatusSyncSelection {
  const selection: StatusSyncSelection = {
    stale: [],
    skipped: { not_in_flight: 0, no_awb: 0, recently_moved: 0 },
  }

  for (const shipment of shipments) {
    const decision = decideShipmentStale(shipment, now, rules)

    if (decision.stale) selection.stale.push({ shipment: decision.shipment, quietHours: decision.quietHours })
    else selection.skipped[decision.reason] += 1
  }

  return selection
}

// --- The port ---------------------------------------------------------------

/**
 * In-flight orders, with the timestamp of their most recent audit row.
 *
 * The events are read in one query for every order rather than one query per order — a hundred
 * parcels would otherwise be a hundred round trips on a schedule.
 */
async function loadShipments(payload: Payload): Promise<TrackedShipment[]> {
  const { docs: orders } = await payload.find({
    collection: 'orders',
    where: { status: { in: [...IN_FLIGHT_STATUSES] } } satisfies Where,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  if (orders.length === 0) return []

  const { docs: events } = await payload.find({
    collection: 'orderEvents',
    where: { order: { in: orders.map((order) => order.id) } } satisfies Where,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const lastMoved = new Map<number, string>()

  for (const event of events) {
    const orderId = relationshipId(event.order)
    if (orderId === null || typeof event.createdAt !== 'string') continue

    const current = lastMoved.get(orderId)
    if (current === undefined || Date.parse(event.createdAt) > Date.parse(current)) {
      lastMoved.set(orderId, event.createdAt)
    }
  }

  return orders.map((order) => ({
    orderNumber: order.orderNumber,
    status: order.status,
    awbCode: typeof order.awbCode === 'string' ? order.awbCode : null,
    lastMovedAt: lastMoved.get(order.id) ?? null,
  }))
}

export const statusSyncJob: Job = {
  name: 'status-sync',
  description: 'Report shipments whose tracking has gone quiet.',

  async run({ payload, now }: JobContext): Promise<JobCounts> {
    const shipments = await loadShipments(payload)
    const selection = selectStaleShipments(shipments, now)

    for (const { shipment, quietHours } of selection.stale) {
      // Order number, AWB and a duration. No customer, no address (OWASP A09).
      payload.logger.warn(
        { orderNumber: shipment.orderNumber, awbCode: shipment.awbCode, status: shipment.status, quietHours },
        'Shipment has not moved',
      )
    }

    return {
      examined: shipments.length,
      stale: selection.stale.length,
      ...selection.skipped,
    }
  },
}
