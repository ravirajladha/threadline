/**
 * `shipping/trackingApply.ts` and `orders/eventTrail.ts`.
 *
 * A courier is a noisy source — many events per parcel, retried, replayed, sometimes out of order — so
 * most of these cases are about *not* acting, and about the six distinguishable reasons for it. The
 * one that would do real damage is a delivery scan applied to the wrong parcel, so identity is checked
 * before meaning and the tests assert that ordering rather than just the outcomes.
 */
import { describe, expect, it } from 'vitest'

import {
  eventIdsFrom,
  PAYMENT_EVENT_ID_PREFIXES,
  TRACKING_EVENT_ID_PREFIXES,
} from '@/lib/orders/eventTrail'
import { processedEventIdsFrom } from '@/lib/orders/paymentApply'
import {
  decideTrackingApply,
  isNoteworthy,
  trackingNote,
  type TrackingOrderState,
} from '@/lib/shipping/trackingApply'
import type { TrackingEvent } from '@/lib/shipping/types'

const AWB = '123456789012'

function order(overrides: Partial<TrackingOrderState> = {}): TrackingOrderState {
  return {
    orderNumber: '260727-0007',
    status: 'shipped',
    awbCode: AWB,
    processedEventIds: [],
    ...overrides,
  }
}

function event(overrides: Partial<TrackingEvent> = {}): TrackingEvent {
  return {
    id: 'stub_trk_1',
    awbCode: AWB,
    reference: '260727-0007',
    courierStatus: 'DELIVERED',
    occurredAt: '2026-07-27T10:00:00.000Z',
    location: 'Stub Hub',
    ...overrides,
  }
}

describe('decideTrackingApply — applying', () => {
  it('moves a shipped order to delivered', () => {
    expect(decideTrackingApply({ order: order(), event: event() })).toEqual({
      action: 'apply',
      toStatus: 'delivered',
      note: 'DELIVERED stub_trk_1',
    })
  })

  it('moves a packed order to shipped on a pickup scan', () => {
    expect(
      decideTrackingApply({
        order: order({ status: 'packed' }),
        event: event({ courierStatus: 'PICKED UP' }),
      }),
    ).toMatchObject({ action: 'apply', toStatus: 'shipped' })
  })

  it('accepts a scan that arrives before our own booking write landed', () => {
    // A courier can scan the parcel before the AWB is stored on the order, and refusing that would
    // strand the order at `packed` for ever.
    expect(
      decideTrackingApply({
        order: order({ status: 'packed', awbCode: null }),
        event: event({ courierStatus: 'PICKED UP' }),
      }),
    ).toMatchObject({ action: 'apply', toStatus: 'shipped' })
  })
})

describe('decideTrackingApply — refusing', () => {
  it('ignores an event for a different order', () => {
    expect(decideTrackingApply({ order: order(), event: event({ reference: '260727-9999' }) })).toMatchObject(
      { action: 'ignore', reason: 'reference_mismatch' },
    )
  })

  it('ignores an event for a different parcel', () => {
    // The damaging case: marking this order delivered because somebody else's box arrived.
    expect(decideTrackingApply({ order: order(), event: event({ awbCode: '999999999999' }) })).toMatchObject(
      { action: 'ignore', reason: 'awb_mismatch' },
    )
  })

  it('ignores a replayed event', () => {
    expect(
      decideTrackingApply({ order: order({ processedEventIds: ['stub_trk_1'] }), event: event() }),
    ).toMatchObject({ action: 'ignore', reason: 'duplicate_event' })
  })

  it('ignores an informational scan without treating it as a failure', () => {
    expect(
      decideTrackingApply({
        order: order({ status: 'packed' }),
        event: event({ courierStatus: 'PICKUP SCHEDULED' }),
      }),
    ).toMatchObject({ action: 'ignore', reason: 'informational' })
  })

  it('ignores a failed delivery attempt and leaves the order out for delivery', () => {
    expect(
      decideTrackingApply({
        order: order({ status: 'out_for_delivery' }),
        event: event({ courierStatus: 'UNDELIVERED' }),
      }),
    ).toMatchObject({ action: 'ignore', reason: 'informational' })
  })

  it('reports an unrecognised status distinctly, so drift is visible', () => {
    const decision = decideTrackingApply({ order: order(), event: event({ courierStatus: 'TELEPORTED' }) })

    expect(decision).toMatchObject({ action: 'ignore', reason: 'unknown_status', courierStatus: 'TELEPORTED' })
    expect(isNoteworthy(decision)).toBe(true)
  })

  it('ignores rather than throws when the order cannot legally move there', () => {
    // A late or duplicate delivery scan on an already-delivered order. It must not throw: answering a
    // courier with a 500 buys nothing but a retry storm.
    expect(
      decideTrackingApply({ order: order({ status: 'delivered' }), event: event({ id: 'stub_trk_2' }) }),
    ).toMatchObject({ action: 'ignore', reason: 'not_applicable' })
  })

  it('ignores a scan on a terminal order', () => {
    expect(
      decideTrackingApply({ order: order({ status: 'refunded' }), event: event() }),
    ).toMatchObject({ action: 'ignore', reason: 'not_applicable' })
  })

  it('treats every refusal except an unknown status as ordinary noise', () => {
    const noise = [
      decideTrackingApply({ order: order(), event: event({ reference: 'x' }) }),
      decideTrackingApply({ order: order(), event: event({ awbCode: 'x' }) }),
      decideTrackingApply({ order: order({ processedEventIds: ['stub_trk_1'] }), event: event() }),
      decideTrackingApply({ order: order(), event: event({ courierStatus: 'UNDELIVERED' }) }),
    ]

    for (const decision of noise) {
      expect(isNoteworthy(decision)).toBe(false)
    }
  })
})

describe('decideTrackingApply — order of the checks', () => {
  it('reports the wrong order before the wrong parcel', () => {
    expect(
      decideTrackingApply({ order: order(), event: event({ reference: 'nope', awbCode: 'nope' }) }),
    ).toMatchObject({ reason: 'reference_mismatch' })
  })

  it('reports the wrong parcel before a duplicate id', () => {
    // Identity before history: a stranger's event id must never be recorded against our order.
    expect(
      decideTrackingApply({
        order: order({ processedEventIds: ['stub_trk_1'] }),
        event: event({ awbCode: '999999999999' }),
      }),
    ).toMatchObject({ reason: 'awb_mismatch' })
  })

  it('reports a duplicate before interpreting the status', () => {
    expect(
      decideTrackingApply({
        order: order({ processedEventIds: ['stub_trk_1'] }),
        event: event({ courierStatus: 'TELEPORTED' }),
      }),
    ).toMatchObject({ reason: 'duplicate_event' })
  })
})

describe('trackingNote', () => {
  it('carries the courier status and the event id, and nothing else', () => {
    const note = trackingNote(event({ courierStatus: 'OUT FOR DELIVERY', id: 'stub_trk_9' }))

    expect(note).toBe('OUT FOR DELIVERY stub_trk_9')
    // A09: no location, no address, no customer detail in the audit trail.
    expect(note).not.toContain('Stub Hub')
  })

  it('round-trips through the trail it feeds', () => {
    const first = event({ id: 'stub_trk_7' })
    const decision = decideTrackingApply({ order: order(), event: first })

    expect(decision.action).toBe('apply')
    if (decision.action !== 'apply') return

    const replay = decideTrackingApply({
      order: order({ processedEventIds: eventIdsFrom([decision.note], TRACKING_EVENT_ID_PREFIXES) }),
      event: first,
    })

    expect(replay).toMatchObject({ action: 'ignore', reason: 'duplicate_event' })
  })
})

describe('eventIdsFrom', () => {
  it('recovers ids from notes written by either integration', () => {
    const notes = ['payment.captured stub_evt_1', 'DELIVERED stub_trk_2', 'Order placed']

    expect(eventIdsFrom(notes, PAYMENT_EVENT_ID_PREFIXES)).toEqual(['stub_evt_1'])
    expect(eventIdsFrom(notes, TRACKING_EVENT_ID_PREFIXES)).toEqual(['stub_trk_2'])
  })

  it('keeps the two integrations from seeing each other ids', () => {
    // The bug this design exists to prevent: one shared pattern meant tracking ids were invisible to
    // the duplicate check, so every replayed delivery scan looked new.
    expect(eventIdsFrom(['DELIVERED stub_trk_2'], PAYMENT_EVENT_ID_PREFIXES)).toEqual([])
    expect(processedEventIdsFrom(['DELIVERED stub_trk_2'])).toEqual([])
  })

  it('does not let a short prefix match inside a longer one', () => {
    // `evt_` appears inside `stub_evt_1`. Returning `evt_1` would be a different id entirely.
    expect(eventIdsFrom(['payment.captured stub_evt_1'], PAYMENT_EVENT_ID_PREFIXES)).toEqual(['stub_evt_1'])
  })

  it('strips punctuation from the edges of an id', () => {
    expect(eventIdsFrom(['captured (stub_evt_1).'], PAYMENT_EVENT_ID_PREFIXES)).toEqual(['stub_evt_1'])
  })

  it('ignores a bare prefix with no id after it', () => {
    expect(eventIdsFrom(['evt_ stub_trk_'], [...PAYMENT_EVENT_ID_PREFIXES, ...TRACKING_EVENT_ID_PREFIXES])).toEqual([])
  })

  it.each([
    ['a note with no id', ['packed by warehouse']],
    ['null and undefined entries', [null, undefined]],
    ['an empty list', []],
  ])('returns nothing for %s', (_label, notes) => {
    expect(eventIdsFrom(notes, TRACKING_EVENT_ID_PREFIXES)).toEqual([])
  })

  it('finds several ids across several notes', () => {
    expect(
      eventIdsFrom(['DELIVERED stub_trk_1', 'OUT FOR DELIVERY stub_trk_2'], TRACKING_EVENT_ID_PREFIXES),
    ).toEqual(['stub_trk_1', 'stub_trk_2'])
  })
})
