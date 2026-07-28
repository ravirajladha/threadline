/**
 * The customer-facing order timeline.
 *
 * Two things are worth pinning here. The **filter** — which statuses a customer sees — because it
 * has to agree with the notification map or the timeline and the emails tell different stories. And
 * the **ordering**, because the trail arrives in whatever order the query returned and "delivered"
 * above "shipped" on a customer's screen is the kind of bug nobody reports and everybody notices.
 */
import { describe, expect, it } from 'vitest'

import { buildTimeline, isTimelineOpen, TIMELINE_LABELS } from '@/lib/orders/timeline'
import { notificationForStatus } from '@/lib/orders/statusNotification'
import { ORDER_STATUSES } from '@/types'

const AT = (minutes: number): string => new Date(Date.UTC(2026, 6, 28, 10, minutes)).toISOString()

describe('buildTimeline', () => {
  it('renders a status a customer is waiting on', () => {
    const steps = buildTimeline([{ toStatus: 'shipped', createdAt: AT(0) }])

    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ status: 'shipped', label: 'On its way' })
  })

  it('hides internal steps', () => {
    // A box on a table is not news, and hiding it here keeps the timeline honest about what a
    // customer can act on.
    const steps = buildTimeline([
      { toStatus: 'confirmed', createdAt: AT(0) },
      { toStatus: 'packed', createdAt: AT(1) },
      { toStatus: 'shipped', createdAt: AT(2) },
    ])

    expect(steps.map((step) => step.status)).toEqual(['confirmed', 'shipped'])
  })

  it('sorts oldest first regardless of the order rows arrive in', () => {
    const steps = buildTimeline([
      { toStatus: 'delivered', createdAt: AT(20) },
      { toStatus: 'pending', createdAt: AT(0) },
      { toStatus: 'shipped', createdAt: AT(10) },
    ])

    expect(steps.map((step) => step.status)).toEqual(['pending', 'shipped', 'delivered'])
  })

  it('keeps arrival order for events sharing a timestamp', () => {
    // Two writes in the same millisecond happened in the order they were written.
    const steps = buildTimeline([
      { toStatus: 'shipped', createdAt: AT(5) },
      { toStatus: 'out_for_delivery', createdAt: AT(5) },
    ])

    expect(steps.map((step) => step.status)).toEqual(['shipped', 'out_for_delivery'])
  })

  it('sorts an unreadable timestamp to the end, never to the beginning', () => {
    // Parsed as NaN it would otherwise land at 1970 and claim to be the first thing that ever
    // happened to the order.
    const steps = buildTimeline([
      { toStatus: 'delivered', createdAt: 'not a date' },
      { toStatus: 'pending', createdAt: AT(0) },
    ])

    expect(steps[0]?.status).toBe('pending')
  })

  it('is empty for an order with no trail', () => {
    expect(buildTimeline([])).toEqual([])
  })

  it('carries no note from the audit row', () => {
    // `orderEvents.note` holds provider event ids and staff shorthand — audit fields, and audit
    // fields leak (OWASP A09). The type has nowhere to put one; this asserts the shape.
    const steps = buildTimeline([{ toStatus: 'confirmed', createdAt: AT(0) }])

    expect(Object.keys(steps[0] ?? {}).sort()).toEqual(['at', 'detail', 'label', 'status'])
  })
})

describe('what a customer is shown', () => {
  it('has an answer for every order status', () => {
    // Exhaustive by type; this proves a new status cannot slip in as undefined and land silently
    // in a customer's timeline.
    for (const status of ORDER_STATUSES) {
      expect(TIMELINE_LABELS).toHaveProperty(status)
    }
  })

  it('agrees with the notification map about what is internal', () => {
    // The guard that matters: if these two drift, the timeline and the emails tell different
    // stories about the same order. `packed` is the case both are silent about.
    expect(TIMELINE_LABELS.packed).toBeNull()
    expect(notificationForStatus('packed')).toBeNull()
  })

  it('shows statuses the customer is emailed about', () => {
    for (const status of ['confirmed', 'shipped', 'out_for_delivery', 'delivered', 'refunded'] as const) {
      expect(notificationForStatus(status)).not.toBeNull()
      expect(TIMELINE_LABELS[status]).not.toBeNull()
    }
  })

  it('shows some statuses that send no email', () => {
    // Deliberately not symmetric: `pending` and `rto` belong on a timeline the customer is reading
    // on purpose, but not in an inbox they did not ask for.
    expect(notificationForStatus('pending')).toBeNull()
    expect(TIMELINE_LABELS.pending).not.toBeNull()
    expect(TIMELINE_LABELS.rto).not.toBeNull()
  })
})

describe('isTimelineOpen', () => {
  it('leaves an in-flight order open', () => {
    for (const status of ['pending', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'rto'] as const) {
      expect(isTimelineOpen(status)).toBe(true)
    }
  })

  it('closes a finished one', () => {
    for (const status of ['delivered', 'cancelled', 'refunded', 'payment_failed', 'returned'] as const) {
      expect(isTimelineOpen(status)).toBe(false)
    }
  })
})
