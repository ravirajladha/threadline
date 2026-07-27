/**
 * `shipping/statusMap.ts` — the courier vocabulary table.
 *
 * The case worth writing tests for is not the happy mapping; it is the two ways of saying "nothing
 * changes", because collapsing them is a silent failure. `undelivered` reaching `delivered` through
 * some substring fallback would close orders that are still out for delivery, and an unrecognised
 * code being treated as informational would let a provider rename its statuses without anyone
 * noticing that tracking had stopped working.
 */
import { describe, expect, it } from 'vitest'

import {
  COURIER_STATUS_MAP,
  INFORMATIONAL_COURIER_STATUSES,
  mapCourierStatus,
  normaliseCourierStatus,
} from '@/lib/shipping/statusMap'
import { ORDER_STATUSES } from '@/types'

describe('normaliseCourierStatus', () => {
  it.each([
    ['RTO Initiated', 'rto_initiated'],
    ['rto-initiated', 'rto_initiated'],
    ['RTO   INITIATED', 'rto_initiated'],
    ['  rto_initiated  ', 'rto_initiated'],
    ['Out For Delivery!', 'out_for_delivery'],
    ['PICKED-UP', 'picked_up'],
  ])('reduces %o to %o', (input, expected) => {
    expect(normaliseCourierStatus(input)).toBe(expected)
  })

  it('collapses a string with nothing usable in it to empty', () => {
    expect(normaliseCourierStatus('---')).toBe('')
    expect(normaliseCourierStatus('   ')).toBe('')
  })
})

describe('mapCourierStatus', () => {
  it.each([
    ['PICKED UP', 'shipped'],
    ['In Transit', 'shipped'],
    ['OUT FOR DELIVERY', 'out_for_delivery'],
    ['Delivered', 'delivered'],
    ['RTO INITIATED', 'rto'],
    ['rto_delivered', 'rto'],
    ['CANCELED', 'cancelled'],
    ['cancelled', 'cancelled'],
  ])('maps %o to the %o status', (courierStatus, expected) => {
    expect(mapCourierStatus(courierStatus)).toEqual({ kind: 'status', status: expected })
  })

  it('treats a failed delivery attempt as informational, not as a delivery', () => {
    // The single most damaging mistake this table could make: a substring match on "deliver" would
    // close the order, release the parcel from tracking and stop the customer being chased.
    expect(mapCourierStatus('UNDELIVERED')).toEqual({
      kind: 'no_change',
      courierStatus: 'UNDELIVERED',
    })
    expect(mapCourierStatus('Consignee Unavailable')).toMatchObject({ kind: 'no_change' })
  })

  it('reports an unrecognised status as unknown rather than ignoring it quietly', () => {
    expect(mapCourierStatus('TELEPORTED')).toEqual({ kind: 'unknown', courierStatus: 'TELEPORTED' })
  })

  it('keeps the courier original on both no-change answers, for support and for logs', () => {
    expect(mapCourierStatus('Address Query')).toEqual({
      kind: 'no_change',
      courierStatus: 'Address Query',
    })
  })

  it('treats a blank or punctuation-only status as unknown, not as a lookup on the empty key', () => {
    expect(mapCourierStatus('')).toEqual({ kind: 'unknown', courierStatus: '' })
    expect(mapCourierStatus('   ')).toMatchObject({ kind: 'unknown' })
    expect(mapCourierStatus('!!!')).toMatchObject({ kind: 'unknown' })
  })
})

describe('the table itself', () => {
  it('only ever maps to a real order status', () => {
    for (const status of Object.values(COURIER_STATUS_MAP)) {
      expect(ORDER_STATUSES).toContain(status)
    }
  })

  it('stores every key already normalised, so every entry is reachable', () => {
    // A key like `RTO Initiated` in the table would never match, because lookup normalises first.
    // That is a typo no type can catch, so it is asserted instead.
    for (const key of Object.keys(COURIER_STATUS_MAP)) {
      expect(key).toBe(normaliseCourierStatus(key))
    }

    for (const key of INFORMATIONAL_COURIER_STATUSES) {
      expect(key).toBe(normaliseCourierStatus(key))
    }
  })

  it('never lists a status as both mapped and informational', () => {
    // An overlap would be decided by check order rather than by intent, which is exactly the kind of
    // ambiguity that survives review.
    const mapped = new Set(Object.keys(COURIER_STATUS_MAP))
    const overlap = [...INFORMATIONAL_COURIER_STATUSES].filter((key) => mapped.has(key))

    expect(overlap).toEqual([])
  })
})
