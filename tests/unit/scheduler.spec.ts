/**
 * The scheduler — the registry, the runner, and the four decisions.
 *
 * The ports are thin reads; what is worth pinning is the judgement each job makes about *who
 * qualifies*, because every one of those rules exists to stop a message being sent to somebody who
 * should not receive it. A cron that fires hourly turns a wrong rule into an hourly wrong rule.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createJobRegistry,
  DuplicateJobError,
  findJob,
  JOB_REGISTRY,
  MissingJobError,
} from '@/lib/scheduler/registry'
import { runJob, JobTimeoutError } from '@/lib/scheduler/runner'
import { isJobName, JOB_NAMES, type Job, type JobContext } from '@/lib/scheduler/types'
import {
  decideAbandonedCart,
  selectAbandonedCarts,
  type AbandonedCartCandidate,
} from '@/lib/scheduler/jobs/abandonedCart'
import {
  decideShipmentStale,
  selectStaleShipments,
  type TrackedShipment,
} from '@/lib/scheduler/jobs/statusSync'
import {
  decideRestockAlert,
  restockSubject,
  selectRestockAlerts,
  type RestockSubscription,
} from '@/lib/scheduler/jobs/stockAlerts'
import {
  decideReviewRequest,
  selectReviewRequests,
  type ReviewCandidate,
} from '@/lib/scheduler/jobs/reviewRequests'
import { claimsSubject } from '@/lib/notify/queue'
import type { Payload } from 'payload'

const NOW = new Date('2026-07-27T12:00:00.000Z')

/** `hours` before `NOW`, as ISO. */
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString()
}

function daysAgo(days: number): string {
  return hoursAgo(days * 24)
}

function fakeContext(): JobContext {
  return {
    now: NOW,
    payload: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as Payload,
  }
}

describe('registry', () => {
  it('registers every advertised job exactly once', () => {
    expect([...JOB_REGISTRY.keys()].sort()).toEqual([...JOB_NAMES].sort())
  })

  it('refuses two jobs under one name', () => {
    const job = (name: string): Job => ({ name: name as Job['name'], description: '', run: async () => ({}) })

    expect(() => createJobRegistry([job('status-sync'), job('status-sync')])).toThrow(DuplicateJobError)
  })

  it('refuses a registry missing an advertised job', () => {
    // Advertising a name the route will accept and nothing implements is a 404 with no explanation.
    expect(() => createJobRegistry([])).toThrow(MissingJobError)
  })

  it('finds a job by name', () => {
    expect(findJob('stock-alerts')?.name).toBe('stock-alerts')
  })

  it('returns null for anything that is not a job name', () => {
    // The whole reason `/api/cron/[job]` cannot be an execution surface.
    for (const value of ['../../etc/passwd', 'constructor', '__proto__', 'toString', '', null, 42]) {
      expect(findJob(value)).toBeNull()
    }
  })

  it('does not treat an inherited property as a job name', () => {
    expect(isJobName('constructor')).toBe(false)
  })
})

describe('runner', () => {
  const job = (run: Job['run']): Job => ({ name: 'status-sync', description: 'test', run })

  it('returns the counts a job reports', async () => {
    const result = await runJob(job(async () => ({ examined: 3, stale: 1 })), fakeContext())

    expect(result).toMatchObject({ ok: true, job: 'status-sync', counts: { examined: 3, stale: 1 } })
  })

  it('turns a throw into a failed result rather than propagating it', async () => {
    // One job failing must never take down the cron request or the jobs beside it.
    const result = await runJob(
      job(async () => {
        throw new Error('database went away')
      }),
      fakeContext(),
    )

    expect(result).toMatchObject({ ok: false, error: 'database went away' })
  })

  it('reports a non-Error throw without inventing detail', async () => {
    const result = await runJob(
      job(async () => {
        throw { weird: true }
      }),
      fakeContext(),
    )

    expect(result).toMatchObject({ ok: false, error: 'Unknown error' })
  })

  it('logs the failure server-side, where the detail belongs', async () => {
    const context = fakeContext()

    await runJob(
      job(async () => {
        throw new Error('boom')
      }),
      context,
    )

    expect(context.payload.logger.error).toHaveBeenCalled()
  })

  it('fails a job that never finishes', async () => {
    const result = await runJob(job(() => new Promise(() => {})), fakeContext(), { timeoutMs: 5 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a timeout')
    expect(result.error).toContain('did not finish')
  })

  it('names the job and the limit in the timeout', () => {
    expect(new JobTimeoutError('status-sync', 5).message).toContain('status-sync')
  })

  it('measures how long the job took', async () => {
    let time = 1_000
    const clock = () => time

    const result = await runJob(
      job(async () => {
        time += 250
        return {}
      }),
      fakeContext(),
      { clock },
    )

    expect(result.durationMs).toBe(250)
  })
})

describe('abandoned carts', () => {
  const cart = (overrides: Partial<AbandonedCartCandidate> = {}): AbandonedCartCandidate => ({
    id: 1,
    email: 'shopper@example.com',
    itemCount: 2,
    updatedAt: hoursAgo(8),
    abandonedNotifiedAt: null,
    ...overrides,
  })

  it('reminds a cart left for longer than the idle window', () => {
    expect(decideAbandonedCart(cart(), NOW)).toMatchObject({ send: true })
  })

  it('leaves a customer who is still shopping alone', () => {
    expect(decideAbandonedCart(cart({ updatedAt: hoursAgo(1) }), NOW)).toMatchObject({
      send: false,
      reason: 'too_recent',
    })
  })

  it('gives up on a cart nobody has touched for days', () => {
    expect(decideAbandonedCart(cart({ updatedAt: daysAgo(10) }), NOW)).toMatchObject({
      send: false,
      reason: 'too_old',
    })
  })

  it('never reminds the same cart twice', () => {
    // Without this an hourly cron is an hourly email.
    expect(decideAbandonedCart(cart({ abandonedNotifiedAt: hoursAgo(2) }), NOW)).toMatchObject({
      send: false,
      reason: 'already_notified',
    })
  })

  it('skips an empty cart', () => {
    expect(decideAbandonedCart(cart({ itemCount: 0 }), NOW)).toMatchObject({ send: false, reason: 'empty' })
  })

  it('skips a cart with nowhere to send a reminder', () => {
    expect(decideAbandonedCart(cart({ email: '  ' }), NOW)).toMatchObject({
      send: false,
      reason: 'no_contact',
    })
  })

  it('treats an unreadable timestamp as too recent, never as ancient', () => {
    // Failing towards not mailing someone is the only safe direction here.
    expect(decideAbandonedCart(cart({ updatedAt: 'not a date' }), NOW)).toMatchObject({
      send: false,
      reason: 'too_recent',
    })
  })

  it('counts every skip by reason', () => {
    const selection = selectAbandonedCarts(
      [cart(), cart({ itemCount: 0 }), cart({ updatedAt: hoursAgo(1) }), cart({ email: null })],
      NOW,
    )

    expect(selection.send).toHaveLength(1)
    expect(selection.skipped).toMatchObject({ empty: 1, too_recent: 1, no_contact: 1 })
  })
})

describe('status sync', () => {
  const shipment = (overrides: Partial<TrackedShipment> = {}): TrackedShipment => ({
    orderNumber: '260727-0001',
    status: 'shipped',
    awbCode: '000123456789',
    lastMovedAt: hoursAgo(72),
    ...overrides,
  })

  it('flags a parcel that has not moved for longer than the window', () => {
    expect(decideShipmentStale(shipment(), NOW)).toMatchObject({ stale: true, quietHours: 72 })
  })

  it('leaves a parcel that moved this morning alone', () => {
    expect(decideShipmentStale(shipment({ lastMovedAt: hoursAgo(3) }), NOW)).toMatchObject({
      stale: false,
      reason: 'recently_moved',
    })
  })

  it('ignores an order that is not in a courier’s hands', () => {
    expect(decideShipmentStale(shipment({ status: 'delivered' }), NOW)).toMatchObject({
      stale: false,
      reason: 'not_in_flight',
    })
  })

  it('ignores an in-flight order with no AWB', () => {
    expect(decideShipmentStale(shipment({ awbCode: null }), NOW)).toMatchObject({
      stale: false,
      reason: 'no_awb',
    })
  })

  it('flags an in-flight parcel with no history at all', () => {
    // An order that reached `shipped` without an audit row is a bug; reporting it as fine hides it.
    expect(decideShipmentStale(shipment({ lastMovedAt: null }), NOW)).toMatchObject({ stale: true })
  })

  it('counts the fleet', () => {
    const selection = selectStaleShipments(
      [shipment(), shipment({ status: 'out_for_delivery', lastMovedAt: hoursAgo(1) }), shipment({ awbCode: '' })],
      NOW,
    )

    expect(selection.stale).toHaveLength(1)
    expect(selection.skipped).toMatchObject({ recently_moved: 1, no_awb: 1 })
  })
})

describe('stock alerts', () => {
  const subscription = (overrides: Partial<RestockSubscription> = {}): RestockSubscription => ({
    id: 1,
    customerId: 5,
    email: 'watcher@example.com',
    sku: 'TL-SHIRT-NAVY-M',
    available: 3,
    notifyOnRestock: true,
    ...overrides,
  })

  it('alerts a watcher when the variant is buyable again', () => {
    expect(decideRestockAlert(subscription())).toMatchObject({ alert: true })
  })

  it('says nothing while the variant is still out of stock', () => {
    expect(decideRestockAlert(subscription({ available: 0 }))).toMatchObject({
      alert: false,
      reason: 'still_out_of_stock',
    })
  })

  it('says nothing when every unit is reserved for someone else', () => {
    // `available` is already `stockQty − reservedQty`; alerting on raw stock sends people to a
    // page that says sold out.
    expect(decideRestockAlert(subscription({ available: 0 }))).toMatchObject({ alert: false })
  })

  it('respects an unsubscribed row', () => {
    expect(decideRestockAlert(subscription({ notifyOnRestock: false }))).toMatchObject({
      alert: false,
      reason: 'not_subscribed',
    })
  })

  it('keys the subject on the watcher and the variant, not the person', () => {
    const subject = restockSubject(5, 'TL-SHIRT-NAVY-M')

    expect(subject).toBe('restock:5:TL-SHIRT-NAVY-M')
    // Two sizes of the same shirt are two subscriptions and two messages.
    expect(subject).not.toBe(restockSubject(5, 'TL-SHIRT-NAVY-L'))
  })

  it('counts what it passed over', () => {
    const selection = selectRestockAlerts([
      subscription(),
      subscription({ available: 0 }),
      subscription({ email: null }),
    ])

    expect(selection.alert).toHaveLength(1)
    expect(selection.skipped).toMatchObject({ still_out_of_stock: 1, no_contact: 1 })
  })
})

describe('review requests', () => {
  const order = (overrides: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
    orderNumber: '260720-0003',
    status: 'delivered',
    email: 'buyer@example.com',
    deliveredAt: daysAgo(7),
    ...overrides,
  })

  it('asks a week after delivery', () => {
    expect(decideReviewRequest(order(), NOW)).toMatchObject({ ask: true })
  })

  it('does not ask the day the parcel lands', () => {
    expect(decideReviewRequest(order({ deliveredAt: daysAgo(1) }), NOW)).toMatchObject({
      ask: false,
      reason: 'too_soon',
    })
  })

  it('lets the moment pass rather than asking two months later', () => {
    expect(decideReviewRequest(order({ deliveredAt: daysAgo(60) }), NOW)).toMatchObject({
      ask: false,
      reason: 'window_passed',
    })
  })

  it('never asks about an order that came back', () => {
    // The worst message a shop can send is a rating request for a returned parcel.
    for (const status of ['returned', 'refunded', 'rto', 'cancelled'] as const) {
      expect(decideReviewRequest(order({ status }), NOW)).toMatchObject({
        ask: false,
        reason: 'not_delivered',
      })
    }
  })

  it('skips a delivery with no date on it', () => {
    expect(decideReviewRequest(order({ deliveredAt: null }), NOW)).toMatchObject({
      ask: false,
      reason: 'no_delivery_date',
    })
  })

  it('skips an order with no address to write to', () => {
    expect(decideReviewRequest(order({ email: null }), NOW)).toMatchObject({
      ask: false,
      reason: 'no_contact',
    })
  })

  it('counts the batch', () => {
    const selection = selectReviewRequests(
      [order(), order({ deliveredAt: daysAgo(1) }), order({ status: 'returned' })],
      NOW,
    )

    expect(selection.ask).toHaveLength(1)
    expect(selection.skipped).toMatchObject({ too_soon: 1, not_delivered: 1 })
  })
})

describe('notification dedupe', () => {
  it('recognises a subject already claimed in the log', () => {
    expect(claimsSubject([{ payload: { subject: 'order:260720-0003' } }], 'order:260720-0003')).toBe(true)
  })

  it('matches the subject exactly, never by prefix', () => {
    // A looser rule would let one order's message suppress another's the day order numbers gain
    // a suffix.
    expect(claimsSubject([{ payload: { subject: 'order:260720-0003-A' } }], 'order:260720-0003')).toBe(false)
  })

  it('survives a row whose payload is missing or not an object', () => {
    expect(claimsSubject([{ payload: null }, { payload: 'text' }, {}], 'order:1')).toBe(false)
  })
})
