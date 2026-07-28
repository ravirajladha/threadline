/**
 * Reviews — who may write one, and what a product's reviews add up to.
 *
 * The eligibility tests are mostly about the purchase being *verified* rather than claimed: a
 * review carries a product and an order, and a caller supplying both is choosing what they appear
 * to have bought. The summary tests are mostly about the fit verdict refusing to speak from a thin
 * or split sample, because a confident "runs small" from four reviews sends people to the wrong
 * size with the shop's authority behind it.
 */
import { describe, expect, it } from 'vitest'

import {
  checkReviewEligibility,
  describeReviewRefusal,
  MAX_REVIEW_LENGTH,
  MIN_REVIEW_LENGTH,
  type ReviewableOrder,
} from '@/lib/reviews/eligibility'
import {
  describeFit,
  formatAverage,
  FIT_MAJORITY,
  MIN_FIT_SAMPLE,
  summariseFit,
  summariseRatings,
  type SummarisableReview,
} from '@/lib/reviews/summary'
import { FIT_FEEDBACK } from '@/types'

const BODY = 'Lovely weight of cotton and the collar keeps its shape.'

const order = (overrides: Partial<ReviewableOrder> = {}): ReviewableOrder => ({
  orderNumber: 'TL-260720-0003',
  status: 'delivered',
  productIds: [100, 200],
  ...overrides,
})

const check = (overrides: Partial<Parameters<typeof checkReviewEligibility>[0]> = {}) =>
  checkReviewEligibility({
    intent: { productId: 100, orderNumber: 'TL-260720-0003' },
    order: order(),
    alreadyReviewed: false,
    rating: 5,
    body: BODY,
    ...overrides,
  })

describe('review eligibility', () => {
  it('allows a review of something delivered', () => {
    expect(check()).toEqual({ ok: true })
  })

  it('refuses when the order is not theirs or does not exist', () => {
    // One answer for both — distinguishing them confirms which order numbers are real.
    expect(check({ order: null })).toMatchObject({ refusal: { reason: 'no_order' } })
  })

  it('refuses a product that is not on the order', () => {
    // The heart of "verified purchase": the product is looked for among the order's own lines,
    // never taken from the request.
    expect(check({ intent: { productId: 999, orderNumber: 'TL-260720-0003' } })).toMatchObject({
      refusal: { reason: 'not_purchased' },
    })
  })

  it('gives an unknown order and an unpurchased product the same message', () => {
    expect(describeReviewRefusal({ reason: 'no_order' })).toBe(
      describeReviewRefusal({ reason: 'not_purchased' }),
    )
  })

  it('refuses until the parcel has arrived', () => {
    // A review written before delivery is about shipping, or about anticipation.
    for (const status of ['pending', 'confirmed', 'packed', 'shipped', 'out_for_delivery'] as const) {
      expect(check({ order: order({ status }) })).toMatchObject({ refusal: { reason: 'not_delivered' } })
    }
  })

  it('allows only one review per product per customer', () => {
    // Not per order: buying the same shirt three times is one opinion, and three entries would let
    // a single voice move the average.
    expect(check({ alreadyReviewed: true })).toMatchObject({ refusal: { reason: 'already_reviewed' } })
  })

  it('refuses a rating outside one to five', () => {
    for (const rating of [0, 6, -1, 4.5, Number.NaN]) {
      expect(check({ rating })).toMatchObject({ refusal: { reason: 'bad_rating' } })
    }
  })

  it('refuses a body that is too short or too long', () => {
    expect(check({ body: '   ' })).toMatchObject({ refusal: { reason: 'bad_body' } })
    expect(check({ body: 'x'.repeat(MIN_REVIEW_LENGTH - 1) })).toMatchObject({ refusal: { reason: 'bad_body' } })
    expect(check({ body: 'x'.repeat(MAX_REVIEW_LENGTH + 1) })).toMatchObject({ refusal: { reason: 'bad_body' } })
  })

  it('has no time limit', () => {
    // Deliberately unlike returns: a review of something worn for six months is more useful, not
    // less. The signature takes no clock at all, which is the design stated as a type.
    expect(check()).toEqual({ ok: true })
  })

  it('explains every refusal in a sentence', () => {
    for (const refusal of [
      { reason: 'no_order' as const },
      { reason: 'not_delivered' as const, status: 'shipped' as const },
      { reason: 'not_purchased' as const },
      { reason: 'already_reviewed' as const },
      { reason: 'bad_rating' as const },
      { reason: 'bad_body' as const },
    ]) {
      expect(describeReviewRefusal(refusal).length).toBeGreaterThan(10)
    }
  })
})

describe('rating summary', () => {
  const reviews = (...ratings: number[]): SummarisableReview[] => ratings.map((rating) => ({ rating }))

  it('counts and averages', () => {
    const summary = summariseRatings(reviews(5, 4, 4))

    expect(summary.count).toBe(3)
    expect(formatAverage(summary)).toBe('4.3')
  })

  it('carries the average as tenths so it rounds once', () => {
    // A float rounded at each render is how the same product shows 4.4 on one page and 4.3 on
    // another.
    expect(summariseRatings(reviews(5, 4, 4)).averageTenths).toBe(43)
  })

  it('builds the distribution', () => {
    expect(summariseRatings(reviews(5, 5, 3, 1)).distribution).toEqual({ 1: 1, 2: 0, 3: 1, 4: 0, 5: 2 })
  })

  it('drops an impossible rating rather than clamping it', () => {
    // Clamping a 7 into a 5 invents a five-star review.
    const summary = summariseRatings(reviews(5, 7, 0, 3))

    expect(summary.count).toBe(2)
    expect(summary.distribution[5]).toBe(1)
  })

  it('is empty and zero with no reviews', () => {
    const summary = summariseRatings([])

    expect(summary).toMatchObject({ count: 0, averageTenths: 0 })
    expect(formatAverage(summary)).toBe('0.0')
  })
})

describe('fit summary', () => {
  const fits = (...values: Array<SummarisableReview['fitFeedback']>): SummarisableReview[] =>
    values.map((fitFeedback) => ({ rating: 5, fitFeedback }))

  it('counts only the reviews that answered', () => {
    const summary = summariseFit(fits('runs_small', null, undefined, 'true_to_size'))

    expect(summary.count).toBe(2)
  })

  it('calls a clear majority', () => {
    const summary = summariseFit(fits('runs_small', 'runs_small', 'runs_small', 'runs_small', 'true_to_size'))

    expect(summary.verdict).toBe('runs_small')
    expect(describeFit(summary)).toContain('sizing up')
  })

  it('says nothing from a thin sample', () => {
    // Four unanimous answers is not evidence; a page that says "runs small" from it is a page
    // sending people to the wrong size with the shop's authority behind it.
    const summary = summariseFit(fits(...Array(MIN_FIT_SAMPLE - 1).fill('runs_small')))

    expect(summary.verdict).toBeNull()
    expect(describeFit(summary)).toBeNull()
  })

  it('says nothing when opinions genuinely differ', () => {
    const summary = summariseFit(
      fits('runs_small', 'runs_small', 'true_to_size', 'true_to_size', 'runs_large', 'runs_large'),
    )

    expect(summary.verdict).toBeNull()
  })

  it('needs the configured share, not merely the most votes', () => {
    // 4 of 7 is a plurality and a majority, but below the 60% bar this deliberately sets.
    const summary = summariseFit(
      fits('runs_small', 'runs_small', 'runs_small', 'runs_small', 'true_to_size', 'true_to_size', 'runs_large'),
    )

    expect(4 / 7).toBeLessThan(FIT_MAJORITY)
    expect(summary.verdict).toBeNull()
  })

  it('reads sizing down for a large fit', () => {
    const summary = summariseFit(fits(...Array(MIN_FIT_SAMPLE).fill('runs_large')))

    expect(describeFit(summary)).toContain('sizing down')
  })

  it('has a sentence for every verdict', () => {
    for (const fit of FIT_FEEDBACK) {
      const summary = summariseFit(fits(...Array(MIN_FIT_SAMPLE).fill(fit)))

      expect(describeFit(summary)).not.toBeNull()
    }
  })

  it('ignores a fit value that is not one of ours', () => {
    const summary = summariseFit([{ rating: 5, fitFeedback: 'enormous' as never }])

    expect(summary.count).toBe(0)
  })

  it('is empty with no reviews', () => {
    expect(summariseFit([])).toMatchObject({ count: 0, verdict: null })
  })
})
