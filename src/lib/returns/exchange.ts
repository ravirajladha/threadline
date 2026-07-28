/**
 * Size exchange.
 *
 * A return sends a garment back; an exchange sends one back **and promises a different one out**.
 * That second half is the whole difficulty, and it is a stock problem rather than a returns problem:
 *
 * **The replacement must be held when the exchange is approved, not when it is shipped.** The
 * tempting order — approve, collect, inspect, then look for a medium — is how a customer waits ten
 * days to be told the size they wanted sold out on day two. So an exchange reserves the replacement
 * up front, against the same `reservedQty` a checkout reserves against, and an exchange that cannot
 * be held is refused *while the customer is still on the page and can pick something else*.
 *
 * **Reserving early has a cost, and it is the right cost.** A held unit is unavailable to other
 * shoppers for as long as the exchange takes, and if the return is never sent back the hold has to
 * be released. That is worse for inventory and better for the customer, which is the trade a
 * clothing shop should make — the alternative sells the same medium twice.
 *
 * This module decides; `payloadReturns.ts` applies. The reservation itself is `inventory/reservation.ts`,
 * unchanged from J4 — an exchange is not a new kind of hold, just a different reason for one.
 */
import type { ReservationRequest } from '@/lib/inventory/reservation'

/** What an exchange asks for. One line at a time: swapping two garments is two exchanges. */
export interface ExchangeRequest {
  /** The line being sent back. */
  orderItemId: number
  /** The variant it was bought as. */
  fromVariantId: number
  /** The variant wanted instead. */
  toVariantId: number
  qty: number
}

export type ExchangeRefusal =
  /** The replacement is the same variant that was bought — nothing to exchange. */
  | { reason: 'same_variant' }
  /** Exchanges swap size within one garment; a different product is a return plus a new order. */
  | { reason: 'different_product' }
  /** The replacement is not sellable — discontinued, or a variant that no longer exists. */
  | { reason: 'unavailable' }
  /** It exists and is sellable, but not enough of it is free. */
  | { reason: 'insufficient_stock'; available: number }

export type ExchangeDecision =
  | { ok: true; reservation: ReservationRequest }
  | { ok: false; refusal: ExchangeRefusal }

/** What we need to know about the replacement to decide. */
export interface ReplacementVariant {
  id: number
  productId: number
  isActive: boolean
  /** `stockQty − reservedQty`, floored at zero — the same figure the storefront shows. */
  available: number
}

/**
 * Decide one exchange.
 *
 * `fromProductId` is passed separately rather than read off the replacement, because the check is
 * that the two belong to the *same* product and comparing a value with itself would always pass.
 */
export function decideExchange(input: {
  request: ExchangeRequest
  fromProductId: number
  replacement: ReplacementVariant | null
}): ExchangeDecision {
  const { request, fromProductId, replacement } = input

  if (request.fromVariantId === request.toVariantId) {
    return { ok: false, refusal: { reason: 'same_variant' } }
  }

  // A missing variant and an inactive one are one answer. Distinguishing them would let a customer
  // probe which variant ids exist, and neither is something they can act on differently.
  if (replacement === null || !replacement.isActive) {
    return { ok: false, refusal: { reason: 'unavailable' } }
  }

  // The exchange flow snapshots nothing about price: swapping a medium for a large is even money,
  // and allowing a different product would make it a refund plus a purchase with no payment step.
  if (replacement.productId !== fromProductId) {
    return { ok: false, refusal: { reason: 'different_product' } }
  }

  if (replacement.available < request.qty) {
    return { ok: false, refusal: { reason: 'insufficient_stock', available: replacement.available } }
  }

  return { ok: true, reservation: { variantId: replacement.id, qty: request.qty } }
}

/** A short, customer-facing sentence. Beside the reasons so one cannot outlive the other. */
export function describeExchangeRefusal(refusal: ExchangeRefusal): string {
  switch (refusal.reason) {
    case 'same_variant':
      return 'That is the size you already have. Pick a different one.'
    case 'different_product':
      return 'Exchanges swap the size of the same piece. To order something else, send this back for a refund.'
    case 'unavailable':
      return 'That size is not available to exchange for.'
    case 'insufficient_stock':
      return refusal.available === 0
        ? 'That size has just sold out. Pick another, or send this back for a refund.'
        : `Only ${refusal.available} of that size left — reduce the quantity or pick another size.`
  }
}
