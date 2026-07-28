/**
 * Returns — eligibility, the status machine, and exchanges.
 *
 * Clothing runs 20–40% returns, so this is a main path. Most of the weight is on `checkReturnRequest`,
 * which is the gate between a customer's form and the database: quantities in a request are input,
 * not data, and "return 50 of an item I bought 1 of" is a refund for 49 garments nobody owns.
 */
import { describe, expect, it } from 'vitest'

import {
  checkReturnRequest,
  describeReturnRefusal,
  evaluateReturnEligibility,
  lineEligibility,
  orderReturnRefusal,
  returnWindowClosesAt,
  type ReturnableLine,
  type ReturnableOrder,
} from '@/lib/returns/eligibility'
import {
  assertReturnTransition,
  canTransitionReturn,
  IllegalReturnTransitionError,
  isTerminalReturnStatus,
  RETURN_STATUS_LABELS,
  RETURN_TRANSITIONS,
  STOCK_RESTORED_AT,
} from '@/lib/returns/transitions'
import { decideExchange, describeExchangeRefusal } from '@/lib/returns/exchange'
import { Returns } from '@/collections/Returns'
import { RETURN_STATUSES } from '@/types'

const WINDOW = 7
const DELIVERED = '2026-07-20T10:00:00.000Z'
const NOW = new Date('2026-07-24T10:00:00.000Z') // four days later — inside the window

const order = (overrides: Partial<ReturnableOrder> = {}): ReturnableOrder => ({
  status: 'delivered',
  deliveredAt: DELIVERED,
  ...overrides,
})

const line = (overrides: Partial<ReturnableLine> = {}): ReturnableLine => ({
  orderItemId: 1,
  sku: 'TL-SHIRT-NAVY-M',
  productTitle: 'Oxford shirt',
  sizeLabel: 'M',
  colourName: 'Navy',
  qty: 2,
  alreadyReturned: 0,
  ...overrides,
})

describe('return window', () => {
  it('closes the configured number of days after delivery', () => {
    expect(returnWindowClosesAt(order(), WINDOW)?.toISOString()).toBe('2026-07-27T10:00:00.000Z')
  })

  it('never opens without a delivery date', () => {
    expect(returnWindowClosesAt(order({ deliveredAt: null }), WINDOW)).toBeNull()
    expect(returnWindowClosesAt(order({ deliveredAt: 'not a date' }), WINDOW)).toBeNull()
  })

  it('takes the window from settings rather than a literal', () => {
    // The first number a shop changes when it looks at its margins.
    const short = returnWindowClosesAt(order(), 1)
    const long = returnWindowClosesAt(order(), 30)

    expect(short?.getTime()).toBeLessThan(long?.getTime() ?? 0)
  })
})

describe('order-level eligibility', () => {
  it('allows a delivered order inside the window', () => {
    expect(orderReturnRefusal(order(), WINDOW, NOW)).toBeNull()
  })

  it('refuses an order that has not arrived', () => {
    for (const status of ['pending', 'confirmed', 'packed', 'shipped', 'out_for_delivery'] as const) {
      expect(orderReturnRefusal(order({ status }), WINDOW, NOW)).toMatchObject({ reason: 'not_delivered' })
    }
  })

  it('refuses an order that never reached the customer', () => {
    // `rto` is a refund conversation, not a return — the parcel came back to us already.
    expect(orderReturnRefusal(order({ status: 'rto' }), WINDOW, NOW)).toMatchObject({
      reason: 'not_delivered',
    })
  })

  it('refuses once the window has closed, and says when', () => {
    const refusal = orderReturnRefusal(order(), WINDOW, new Date('2026-07-28T10:00:00.000Z'))

    expect(refusal).toMatchObject({ reason: 'window_closed' })
    // "Not eligible" with no date is the message that generates a support ticket.
    expect(describeReturnRefusal(refusal!)).toContain('27 Jul')
  })

  it('allows a return on the last day of the window', () => {
    // Off-by-one here is a customer refused on the day the shop promised them.
    expect(orderReturnRefusal(order(), WINDOW, new Date('2026-07-27T09:59:59.000Z'))).toBeNull()
  })

  it('flags a delivered order with no recorded date rather than guessing', () => {
    expect(orderReturnRefusal(order({ deliveredAt: null }), WINDOW, NOW)).toMatchObject({
      reason: 'no_delivery_date',
    })
  })
})

describe('line-level eligibility', () => {
  it('offers the full quantity of an untouched line', () => {
    expect(lineEligibility(order(), line(), WINDOW, NOW)).toMatchObject({ eligible: true, maxQty: 2 })
  })

  it('offers only what is left after a partial return', () => {
    expect(lineEligibility(order(), line({ alreadyReturned: 1 }), WINDOW, NOW)).toMatchObject({
      eligible: true,
      maxQty: 1,
    })
  })

  it('refuses a line that is entirely inside a return already', () => {
    expect(lineEligibility(order(), line({ alreadyReturned: 2 }), WINDOW, NOW)).toMatchObject({
      eligible: false,
      refusal: { reason: 'already_returned' },
    })
  })

  it('never offers a negative quantity', () => {
    // A data problem that made `alreadyReturned` exceed `qty` would otherwise render as an input
    // that accepts anything.
    expect(lineEligibility(order(), line({ alreadyReturned: 5 }), WINDOW, NOW)).toMatchObject({
      eligible: false,
    })
  })

  it('decides per line rather than per order', () => {
    // The ordinary case: three things bought, one going back.
    const result = evaluateReturnEligibility({
      order: order(),
      lines: [line(), line({ orderItemId: 2, alreadyReturned: 2 })],
      windowDays: WINDOW,
      now: NOW,
    })

    expect(result.anyReturnable).toBe(true)
    expect(result.lines.map((entry) => entry.eligible)).toEqual([true, false])
  })
})

describe('checkReturnRequest', () => {
  const eligibility = evaluateReturnEligibility({
    order: order(),
    lines: [line(), line({ orderItemId: 2, qty: 1 })],
    windowDays: WINDOW,
    now: NOW,
  })

  it('accepts a request within what was bought', () => {
    expect(checkReturnRequest({ eligibility, requested: [{ orderItemId: 1, qty: 2 }] })).toMatchObject({
      ok: true,
    })
  })

  it('refuses more than was bought', () => {
    // The whole reason this gate exists — a form can be edited.
    expect(checkReturnRequest({ eligibility, requested: [{ orderItemId: 1, qty: 50 }] })).toMatchObject({
      ok: false,
      refusal: { reason: 'qty_too_high', maxQty: 2 },
    })
  })

  it('refuses a quantity that is not a whole number of at least one', () => {
    for (const qty of [0, -1, 1.5, Number.NaN]) {
      expect(checkReturnRequest({ eligibility, requested: [{ orderItemId: 1, qty }] })).toMatchObject({
        ok: false,
        refusal: { reason: 'qty_invalid' },
      })
    }
  })

  it('refuses a line that is not on this order', () => {
    // Refused rather than dropped: silently ignoring it returns less than the customer asked for.
    expect(checkReturnRequest({ eligibility, requested: [{ orderItemId: 999, qty: 1 }] })).toMatchObject({
      ok: false,
      refusal: { reason: 'unknown_line' },
    })
  })

  it('refuses an empty request', () => {
    expect(checkReturnRequest({ eligibility, requested: [] })).toMatchObject({
      ok: false,
      refusal: { reason: 'no_lines' },
    })
  })

  it('refuses every line when the order itself is out of window', () => {
    const closed = evaluateReturnEligibility({
      order: order(),
      lines: [line()],
      windowDays: WINDOW,
      now: new Date('2026-08-30T10:00:00.000Z'),
    })

    expect(checkReturnRequest({ eligibility: closed, requested: [{ orderItemId: 1, qty: 1 }] })).toMatchObject({
      ok: false,
      refusal: { reason: 'line_refused' },
    })
  })
})

describe('return status machine', () => {
  it('walks the ordinary path', () => {
    expect(canTransitionReturn('requested', 'approved')).toBe(true)
    expect(canTransitionReturn('approved', 'picked_up')).toBe(true)
    expect(canTransitionReturn('picked_up', 'received')).toBe(true)
    expect(canTransitionReturn('received', 'refunded')).toBe(true)
  })

  it('forks at received into money or a replacement', () => {
    expect(canTransitionReturn('received', 'exchange_shipped')).toBe(true)
    expect(isTerminalReturnStatus('exchange_shipped')).toBe(true)
  })

  it('never reaches a refund without receiving the goods', () => {
    // The rule that keeps money and inspection in the right order.
    for (const status of ['requested', 'approved', 'picked_up'] as const) {
      expect(canTransitionReturn(status, 'refunded')).toBe(false)
    }
  })

  it('restores stock at exactly one status, after inspection', () => {
    expect(STOCK_RESTORED_AT).toBe('received')
  })

  it('keeps rejection reachable until the goods are with us', () => {
    // A parcel can go missing between the doorstep and the warehouse.
    expect(canTransitionReturn('picked_up', 'rejected')).toBe(true)
    expect(canTransitionReturn('received', 'rejected')).toBe(false)
  })

  it('treats rejection and refund as final', () => {
    for (const status of ['rejected', 'refunded', 'exchange_shipped'] as const) {
      expect(isTerminalReturnStatus(status)).toBe(true)
    }
  })

  it('refuses a move to the same status', () => {
    // How a double-clicked button refunds twice.
    for (const status of RETURN_STATUSES) {
      expect(canTransitionReturn(status, status)).toBe(false)
    }
  })

  it('throws on an illegal move', () => {
    expect(() => assertReturnTransition('refunded', 'requested')).toThrow(IllegalReturnTransitionError)
  })

  it('has an entry and a label for every status', () => {
    for (const status of RETURN_STATUSES) {
      expect(RETURN_TRANSITIONS).toHaveProperty(status)
      expect(RETURN_STATUS_LABELS[status].length).toBeGreaterThan(0)
    }
  })
})

describe('exchange', () => {
  const request = { orderItemId: 1, fromVariantId: 10, toVariantId: 11, qty: 1 }
  const replacement = { id: 11, productId: 100, isActive: true, available: 3 }

  it('holds the replacement when it is available', () => {
    expect(decideExchange({ request, fromProductId: 100, replacement })).toMatchObject({
      ok: true,
      reservation: { variantId: 11, qty: 1 },
    })
  })

  it('refuses a swap for the same size', () => {
    expect(
      decideExchange({ request: { ...request, toVariantId: 10 }, fromProductId: 100, replacement }),
    ).toMatchObject({ ok: false, refusal: { reason: 'same_variant' } })
  })

  it('refuses a swap to a different product', () => {
    // Otherwise it is a refund plus a purchase with no payment step.
    expect(
      decideExchange({ request, fromProductId: 100, replacement: { ...replacement, productId: 200 } }),
    ).toMatchObject({ ok: false, refusal: { reason: 'different_product' } })
  })

  it('gives a missing variant and an inactive one the same answer', () => {
    // Distinguishing them lets a customer probe which variant ids exist.
    expect(decideExchange({ request, fromProductId: 100, replacement: null })).toMatchObject({
      refusal: { reason: 'unavailable' },
    })
    expect(
      decideExchange({ request, fromProductId: 100, replacement: { ...replacement, isActive: false } }),
    ).toMatchObject({ refusal: { reason: 'unavailable' } })
  })

  it('refuses when not enough is free, and says how many are', () => {
    const decision = decideExchange({
      request: { ...request, qty: 5 },
      fromProductId: 100,
      replacement,
    })

    expect(decision).toMatchObject({ ok: false, refusal: { reason: 'insufficient_stock', available: 3 } })
    expect(describeExchangeRefusal({ reason: 'insufficient_stock', available: 3 })).toContain('3')
  })

  it('reads sold out differently from short', () => {
    expect(describeExchangeRefusal({ reason: 'insufficient_stock', available: 0 })).toContain('sold out')
  })

  it('judges availability net of other reservations', () => {
    // `available` is `stockQty − reservedQty`, so an exchange cannot be promised against units held
    // for somebody else's checkout.
    expect(
      decideExchange({ request, fromProductId: 100, replacement: { ...replacement, available: 0 } }),
    ).toMatchObject({ ok: false })
  })

  it('explains every refusal in a sentence', () => {
    for (const refusal of [
      { reason: 'same_variant' as const },
      { reason: 'different_product' as const },
      { reason: 'unavailable' as const },
      { reason: 'insufficient_stock' as const, available: 1 },
    ]) {
      expect(describeExchangeRefusal(refusal).length).toBeGreaterThan(10)
    }
  })
})

// --- Collection access -------------------------------------------------------

describe('collection access', () => {
  const call = (fn: unknown, user: unknown): unknown =>
    (fn as (args: { req: { user: unknown } }) => unknown)({ req: { user } })

  const CUSTOMER = { id: 5, collection: 'customers' }
  const ORDER_MANAGER = { id: 2, collection: 'users', role: 'order_manager', isActive: true }
  const SUPPORT_AGENT = { id: 3, collection: 'users', role: 'support_agent', isActive: true }

  it('does not let a customer create a return through the collection', () => {
    // The J8 pass found this open, and it was worse than the tickets equivalent: `returns` has no
    // owner hook at all, so a customer could POST one against a stranger's order id with a status
    // and a refundAmount of their choosing. Read scoping hid it, which is what made it quiet.
    expect(call(Returns.access?.create, CUSTOMER)).toBe(false)
    expect(call(Returns.access?.create, null)).toBe(false)
  })

  it('lets a role with refunds create one on a customer’s behalf', () => {
    expect(call(Returns.access?.create, ORDER_MANAGER)).toBe(true)
  })

  it('scopes a customer’s read through the order they own', () => {
    // There is no `customer` column on a return; ownership is the order's.
    expect(call(Returns.access?.read, CUSTOMER)).toMatchObject({ 'order.customer': { equals: 5 } })
    expect(call(Returns.access?.read, null)).toBe(false)
  })

  it('lets a support agent see every return and approve none', () => {
    // `support_agent` has orders: read and refunds: none — the split the collection documents.
    expect(call(Returns.access?.read, SUPPORT_AGENT)).toBe(true)
    expect(call(Returns.access?.update, SUPPORT_AGENT)).toBe(false)
  })

  it('never lets a customer write to a return directly', () => {
    // Otherwise they set their own status and their own refund amount.
    expect(call(Returns.access?.update, CUSTOMER)).toBe(false)
    expect(call(Returns.access?.delete, CUSTOMER)).toBe(false)
  })
})
