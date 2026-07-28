/**
 * What can be sent back, and why the rest cannot.
 *
 * Clothing runs 20–40% returns, so this is a main path rather than an edge case, and it is decided
 * **per line** rather than per order. A customer who bought three things and wants to send one back
 * is the ordinary case; an order-level yes/no would force them to raise three requests or none.
 *
 * Every refusal is typed and carries what the customer needs to act — chiefly *when* the window
 * closed, because "not eligible" with no date is the message that generates a support ticket.
 *
 * The window is `settings.returnWindowDays`, never a literal: CLAUDE.md §3 requires anything an
 * admin might change to be config, and the return window is the first thing a shop changes when
 * it looks at its margins.
 */
import type { OrderStatus } from '@/types'

/** The order-level facts a return decision needs. */
export interface ReturnableOrder {
  status: OrderStatus
  /** When the courier delivered it. Null if the status arrived without one. */
  deliveredAt: string | null
}

/** One purchased line, and what has already happened to it. */
export interface ReturnableLine {
  orderItemId: number
  sku: string
  productTitle: string
  sizeLabel: string
  colourName: string
  /** How many were bought. */
  qty: number
  /** How many are already inside a return that has not been rejected. */
  alreadyReturned: number
}

export type ReturnRefusal =
  /** The parcel has not arrived, so there is nothing to send back yet. */
  | { reason: 'not_delivered'; status: OrderStatus }
  /** Delivered, but the system never recorded when — staff have to judge this one. */
  | { reason: 'no_delivery_date' }
  /** Past the window. Carries the day it closed. */
  | { reason: 'window_closed'; closedOn: string }
  /** Every unit on this line is already inside a return. */
  | { reason: 'already_returned' }

export type LineEligibility =
  | { eligible: true; line: ReturnableLine; maxQty: number }
  | { eligible: false; line: ReturnableLine; refusal: ReturnRefusal }

const DAY_MS = 86_400_000

/** When the window closes for an order, or null if it never opened. */
export function returnWindowClosesAt(order: ReturnableOrder, windowDays: number): Date | null {
  if (order.deliveredAt === null) return null

  const delivered = Date.parse(order.deliveredAt)
  if (Number.isNaN(delivered)) return null

  return new Date(delivered + windowDays * DAY_MS)
}

/**
 * The order-level refusal, or null when the order itself is returnable.
 *
 * Separated from the per-line check so a page can say "this order is past its window" once rather
 * than repeating it against every line.
 */
export function orderReturnRefusal(
  order: ReturnableOrder,
  windowDays: number,
  now: Date,
): ReturnRefusal | null {
  // Only a delivered order. `returned` and `refunded` are past this point, and `rto` means the
  // parcel never reached them — that is a refund conversation, not a return.
  if (order.status !== 'delivered') return { reason: 'not_delivered', status: order.status }

  const closesAt = returnWindowClosesAt(order, windowDays)
  if (closesAt === null) return { reason: 'no_delivery_date' }

  if (now.getTime() > closesAt.getTime()) {
    return { reason: 'window_closed', closedOn: closesAt.toISOString() }
  }

  return null
}

/** Whether one line can be returned, and how many of it. */
export function lineEligibility(
  order: ReturnableOrder,
  line: ReturnableLine,
  windowDays: number,
  now: Date,
): LineEligibility {
  const refusal = orderReturnRefusal(order, windowDays, now)
  if (refusal !== null) return { eligible: false, line, refusal }

  // Floored at zero rather than trusted: a data problem that made `alreadyReturned` exceed `qty`
  // would otherwise produce a negative maximum, which a naive UI renders as an input that accepts
  // anything.
  const maxQty = Math.max(0, line.qty - line.alreadyReturned)

  if (maxQty === 0) return { eligible: false, line, refusal: { reason: 'already_returned' } }

  return { eligible: true, line, maxQty }
}

export interface OrderEligibility {
  /** Null when at least one line can be returned. */
  refusal: ReturnRefusal | null
  lines: LineEligibility[]
  /** Convenience for the page: is there anything at all to offer? */
  anyReturnable: boolean
}

export function evaluateReturnEligibility(input: {
  order: ReturnableOrder
  lines: readonly ReturnableLine[]
  windowDays: number
  now: Date
}): OrderEligibility {
  const { order, lines, windowDays, now } = input

  const evaluated = lines.map((line) => lineEligibility(order, line, windowDays, now))

  return {
    refusal: orderReturnRefusal(order, windowDays, now),
    lines: evaluated,
    anyReturnable: evaluated.some((entry) => entry.eligible),
  }
}

/**
 * Validate a requested return against what is actually eligible.
 *
 * The gate between a customer's request and the database. The quantities in a request are input,
 * not data: a form can be edited, and "return 50 of an item I bought 1 of" is a refund for 49
 * garments nobody owns (OWASP A04).
 */
export type ReturnRequestRefusal =
  | { reason: 'no_lines' }
  | { reason: 'unknown_line'; orderItemId: number }
  | { reason: 'line_refused'; orderItemId: number; refusal: ReturnRefusal }
  | { reason: 'qty_too_high'; orderItemId: number; maxQty: number }
  | { reason: 'qty_invalid'; orderItemId: number }

export type ReturnRequestCheck =
  | { ok: true; lines: Array<{ orderItemId: number; qty: number }> }
  | { ok: false; refusal: ReturnRequestRefusal }

export function checkReturnRequest(input: {
  eligibility: OrderEligibility
  requested: ReadonlyArray<{ orderItemId: number; qty: number }>
}): ReturnRequestCheck {
  const { eligibility, requested } = input

  // A request with nothing in it is a refusal rather than an empty return, which would otherwise be
  // written as a row nobody can act on.
  if (requested.length === 0) return { ok: false, refusal: { reason: 'no_lines' } }

  const byId = new Map(eligibility.lines.map((entry) => [entry.line.orderItemId, entry]))
  const lines: Array<{ orderItemId: number; qty: number }> = []

  for (const request of requested) {
    const entry = byId.get(request.orderItemId)

    // An id that is not on this order at all. Refused rather than ignored: silently dropping it
    // would return fewer items than the customer believes they asked for.
    if (entry === undefined) {
      return { ok: false, refusal: { reason: 'unknown_line', orderItemId: request.orderItemId } }
    }

    if (!entry.eligible) {
      return {
        ok: false,
        refusal: { reason: 'line_refused', orderItemId: request.orderItemId, refusal: entry.refusal },
      }
    }

    if (!Number.isInteger(request.qty) || request.qty < 1) {
      return { ok: false, refusal: { reason: 'qty_invalid', orderItemId: request.orderItemId } }
    }

    if (request.qty > entry.maxQty) {
      return {
        ok: false,
        refusal: { reason: 'qty_too_high', orderItemId: request.orderItemId, maxQty: entry.maxQty },
      }
    }

    lines.push({ orderItemId: request.orderItemId, qty: request.qty })
  }

  return { ok: true, lines }
}

/** A short, customer-facing sentence for a refusal. Beside the reasons so one cannot outlive the other. */
export function describeReturnRefusal(refusal: ReturnRefusal): string {
  switch (refusal.reason) {
    case 'not_delivered':
      return 'This order has not been delivered yet, so there is nothing to send back.'
    case 'no_delivery_date':
      return 'We do not have a delivery date for this order. Please raise a support request and we will sort it out.'
    case 'window_closed': {
      const closed = new Date(refusal.closedOn)
      const on = Number.isNaN(closed.getTime())
        ? ''
        : ` on ${closed.toLocaleDateString('en-IN', { dateStyle: 'medium' })}`

      return `The return window for this order closed${on}.`
    }
    case 'already_returned':
      return 'You have already requested a return for everything on this line.'
  }
}
