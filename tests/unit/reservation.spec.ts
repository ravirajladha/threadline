import { describe, expect, it } from 'vitest'

import {
  planCommit,
  planRelease,
  planReservation,
  shortageMessage,
  type VariantAvailability,
} from '@/lib/inventory/reservation'

function stock(variantId: number | string, stockQty: number, reservedQty = 0): VariantAvailability {
  return { variantId, stockQty, reservedQty }
}

describe('planReservation', () => {
  it('holds what is available', () => {
    const plan = planReservation([{ variantId: 1, qty: 2 }], [stock(1, 5)])

    expect(plan).toEqual({ ok: true, deltas: [{ variantId: 1, reservedDelta: 2 }] })
  })

  it('counts existing reservations against availability', () => {
    // Three on the shelf, two already held by another checkout: one left.
    const plan = planReservation([{ variantId: 1, qty: 2 }], [stock(1, 3, 2)])

    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.shortages[0]).toEqual({ variantId: 1, requested: 2, available: 1 })
  })

  it('allows the exact last unit', () => {
    expect(planReservation([{ variantId: 1, qty: 1 }], [stock(1, 3, 2)]).ok).toBe(true)
  })

  it('refuses the whole order rather than reserving part of it', () => {
    // A partial hold leaves the customer holding stock for an order they cannot place.
    const plan = planReservation(
      [
        { variantId: 1, qty: 1 },
        { variantId: 2, qty: 5 },
      ],
      [stock(1, 10), stock(2, 1)],
    )

    expect(plan.ok).toBe(false)
  })

  it('reports every shortage at once', () => {
    const plan = planReservation(
      [
        { variantId: 1, qty: 5 },
        { variantId: 2, qty: 5 },
        { variantId: 3, qty: 1 },
      ],
      [stock(1, 1), stock(2, 0), stock(3, 10)],
    )

    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.shortages.map((s) => s.variantId)).toEqual([1, 2])
  })

  it('treats a variant it cannot find as sold out, not an error', () => {
    const plan = planReservation([{ variantId: 99, qty: 1 }], [])

    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.shortages[0]?.available).toBe(0)
  })

  it('folds two lines of the same variant before checking stock', () => {
    // Checked separately, each of these passes against 3 units and together they oversell 4.
    const plan = planReservation(
      [
        { variantId: 1, qty: 2 },
        { variantId: 1, qty: 2 },
      ],
      [stock(1, 3)],
    )

    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.shortages[0]).toEqual({ variantId: 1, requested: 4, available: 3 })
  })

  it('folds a satisfiable duplicate into one delta', () => {
    const plan = planReservation(
      [
        { variantId: 1, qty: 2 },
        { variantId: 1, qty: 2 },
      ],
      [stock(1, 10)],
    )

    expect(plan).toEqual({ ok: true, deltas: [{ variantId: 1, reservedDelta: 4 }] })
  })

  it('matches ids across number and string forms', () => {
    expect(planReservation([{ variantId: '1', qty: 1 }], [stock(1, 5)]).ok).toBe(true)
  })

  it('never reads negative availability as spare capacity', () => {
    // An over-reservation is a bug to investigate, not a licence to sell more.
    const plan = planReservation([{ variantId: 1, qty: 1 }], [stock(1, 2, 5)])

    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.shortages[0]?.available).toBe(0)
  })

  it('rejects a nonsense quantity outright', () => {
    expect(() => planReservation([{ variantId: 1, qty: 0 }], [stock(1, 5)])).toThrow(RangeError)
    expect(() => planReservation([{ variantId: 1, qty: 1.5 }], [stock(1, 5)])).toThrow(RangeError)
  })
})

describe('planRelease', () => {
  it('gives units back', () => {
    expect(planRelease([{ variantId: 1, qty: 2 }], [stock(1, 5, 2)])).toEqual([
      { variantId: 1, reservedDelta: -2 },
    ])
  })

  it('cannot release more than is held', () => {
    // A double release would drive reservedQty negative, making the variant look like it has
    // more available than physically exists.
    expect(planRelease([{ variantId: 1, qty: 5 }], [stock(1, 5, 2)])).toEqual([
      { variantId: 1, reservedDelta: -2 },
    ])
  })

  it('drops a no-op release entirely', () => {
    expect(planRelease([{ variantId: 1, qty: 2 }], [stock(1, 5, 0)])).toEqual([])
  })

  it('is safe for a variant it has no record of', () => {
    expect(planRelease([{ variantId: 99, qty: 2 }], [])).toEqual([])
  })
})

describe('planCommit', () => {
  it('frees the reservation and moves the same units out of the ledger', () => {
    // Both halves together, or sold stock looks available again — or is counted as gone and
    // still held at once.
    expect(planCommit([{ variantId: 1, qty: 2 }], [stock(1, 5, 2)])).toEqual([
      { variantId: 1, qty: 2, reservedDelta: -2, ledgerQty: 2 },
    ])
  })

  it('still records the sale when the reservation was already lost', () => {
    // The units have been paid for and will ship whatever the counter says; a reservation
    // swept early must not turn into stock that never left.
    expect(planCommit([{ variantId: 1, qty: 2 }], [stock(1, 5, 0)])).toEqual([
      { variantId: 1, qty: 2, reservedDelta: 0, ledgerQty: 2 },
    ])
  })

  it('ignores an empty line', () => {
    expect(planCommit([{ variantId: 1, qty: 0 }], [stock(1, 5, 0)])).toEqual([])
  })
})

describe('shortageMessage', () => {
  it('says a sold-out item has sold out', () => {
    expect(shortageMessage({ variantId: 1, requested: 2, available: 0 }, 'Oxford Shirt (M)')).toContain('sold out')
  })

  it('says how many are left when some are', () => {
    expect(shortageMessage({ variantId: 1, requested: 5, available: 2 }, 'Oxford Shirt (M)')).toContain('Only 2')
  })
})
