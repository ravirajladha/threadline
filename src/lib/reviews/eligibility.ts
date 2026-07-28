/**
 * Who may review what.
 *
 * One rule does most of the work: **the purchase is verified from the order, never claimed by the
 * request.** A review carries a `product` and an `order`, and a caller supplying both is a caller
 * choosing what they appear to have bought — so the order is looked up against the customer, and
 * the product is looked for among *its* lines. "Verified purchase" has to mean something, or the
 * badge is decoration and the star rating is a form anyone can submit (OWASP A04).
 *
 * The rest are judgements about what a review is for:
 *
 * - **Delivered, not merely paid.** A review written before the parcel arrives is about shipping,
 *   or about anticipation. Neither helps the next person choose a size.
 * - **One per product per customer.** Not per order: somebody who buys the same shirt three times
 *   has one opinion of it, and three entries would let a single voice move an average.
 * - **No window.** Deliberately unlike returns and review-request emails, both of which have one. A
 *   review of a garment that has been worn for six months is *more* useful than one written the day
 *   it arrived, and the only reason to close the window would be tidiness.
 */
import type { OrderStatus } from '@/types'

/** What the caller says they want to review. */
export interface ReviewIntent {
  productId: number
  orderNumber: string
}

/** The order behind the claim, as the server found it. */
export interface ReviewableOrder {
  orderNumber: string
  status: OrderStatus
  /** Product ids actually on this order. Read from `orderItems`, never from the request. */
  productIds: readonly number[]
}

export type ReviewRefusal =
  /** No such order, or not this customer's. One answer for both. */
  | { reason: 'no_order' }
  /** Bought, but not arrived. */
  | { reason: 'not_delivered'; status: OrderStatus }
  /** The order is real and delivered, but this product is not on it. */
  | { reason: 'not_purchased' }
  /** They have already said their piece about this product. */
  | { reason: 'already_reviewed' }
  /** Out of the 1–5 range, or not a whole number. */
  | { reason: 'bad_rating' }
  /** Nothing but whitespace, or longer than anybody will read. */
  | { reason: 'bad_body' }

export type ReviewEligibility = { ok: true } | { ok: false; refusal: ReviewRefusal }

/** Long enough for a considered opinion, short enough not to be a database filler. */
export const MAX_REVIEW_LENGTH = 4_000
export const MIN_REVIEW_LENGTH = 10

/**
 * Whether this review may be written.
 *
 * `order` is null when the lookup found nothing *or* found somebody else's — the caller collapses
 * the two, so a reviewer cannot use this endpoint to discover which order numbers are real.
 */
export function checkReviewEligibility(input: {
  intent: ReviewIntent
  order: ReviewableOrder | null
  /** Whether this customer already has a review for this product, in any status. */
  alreadyReviewed: boolean
  rating: number
  body: string
}): ReviewEligibility {
  const { intent, order, alreadyReviewed, rating, body } = input

  if (order === null) return { ok: false, refusal: { reason: 'no_order' } }

  // A review is about wearing the thing. Checked before the purchase itself so an undelivered
  // order gives the more useful message.
  if (order.status !== 'delivered') {
    return { ok: false, refusal: { reason: 'not_delivered', status: order.status } }
  }

  // The heart of it: the product must be on the order the server loaded.
  if (!order.productIds.includes(intent.productId)) {
    return { ok: false, refusal: { reason: 'not_purchased' } }
  }

  if (alreadyReviewed) return { ok: false, refusal: { reason: 'already_reviewed' } }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, refusal: { reason: 'bad_rating' } }
  }

  const trimmed = body.trim()
  if (trimmed.length < MIN_REVIEW_LENGTH || trimmed.length > MAX_REVIEW_LENGTH) {
    return { ok: false, refusal: { reason: 'bad_body' } }
  }

  return { ok: true }
}

/** A short, customer-facing sentence. Beside the reasons so one cannot outlive the other. */
export function describeReviewRefusal(refusal: ReviewRefusal): string {
  switch (refusal.reason) {
    case 'no_order':
    case 'not_purchased':
      // Deliberately one message: distinguishing them would confirm whether an order number is
      // real, and neither is something the customer can act on differently.
      return 'We can only take reviews for something you have bought and received.'
    case 'not_delivered':
      return 'You can review this once it has been delivered.'
    case 'already_reviewed':
      return 'You have already reviewed this piece. Get in touch if you would like to change it.'
    case 'bad_rating':
      return 'Please give it between one and five stars.'
    case 'bad_body':
      return `Please write between ${MIN_REVIEW_LENGTH} and ${MAX_REVIEW_LENGTH.toLocaleString('en-IN')} characters.`
  }
}
