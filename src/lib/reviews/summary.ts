/**
 * What a product's reviews add up to.
 *
 * Two summaries, and the second is the one that earns its place in a clothing shop.
 *
 * **The rating summary** is the ordinary thing: an average and a 1–5 distribution. The average is
 * carried as an integer of tenths rather than a float, for the same reason money is paise — a
 * rounded 4.35 that renders as "4.4" in one place and "4.3" in another is a bug nobody can
 * reproduce. Rounding happens once, here.
 *
 * **The fit summary** is the point. Clothing returns are dominated by size, and the single most
 * useful sentence a product page can carry is "most people found this runs small". That is a
 * *count*, not a comment somebody has to read forty replies to find — and it feeds the same
 * `fitFeedback` values the return reasons use, so the two agree about what "too small" means.
 *
 * Both are pure and take already-published reviews. Whether a review is published is the
 * moderation status on the row, and filtering it here as well would put that rule in two places.
 */
import { FIT_FEEDBACK, type FitFeedback } from '@/types'

/** Just enough of a review to summarise. */
export interface SummarisableReview {
  rating: number
  fitFeedback?: FitFeedback | null
}

export interface RatingSummary {
  count: number
  /** Tenths of a star — 43 is 4.3. Zero when there are no reviews. */
  averageTenths: number
  /** How many gave each rating, indexed 1–5. */
  distribution: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>
}

export interface FitSummary {
  /** How many answered the fit question at all. Often fewer than the review count. */
  count: number
  counts: Readonly<Record<FitFeedback, number>>
  /**
   * The answer worth printing, or null when there is no clear one.
   *
   * Null rather than "true to size" when the sample is thin or split, because a confident claim
   * from four reviews is how a page tells a customer to order a size up and is wrong.
   */
  verdict: FitFeedback | null
}

/** Below this many fit answers, no verdict is offered whatever the split. */
export const MIN_FIT_SAMPLE = 5

/** The share one answer needs before it speaks for the group. */
export const FIT_MAJORITY = 0.6

function emptyDistribution(): Record<1 | 2 | 3 | 4 | 5, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
}

export function summariseRatings(reviews: readonly SummarisableReview[]): RatingSummary {
  const distribution = emptyDistribution()
  let total = 0
  let count = 0

  for (const review of reviews) {
    // A rating outside 1–5 is dropped rather than clamped: clamping a 7 into a 5 invents a
    // five-star review, and the row should not have existed in the first place.
    if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) continue

    distribution[review.rating as 1 | 2 | 3 | 4 | 5] += 1
    total += review.rating
    count += 1
  }

  return {
    count,
    // Rounded once, here, so every surface shows the same number.
    averageTenths: count === 0 ? 0 : Math.round((total / count) * 10),
    distribution,
  }
}

export function summariseFit(reviews: readonly SummarisableReview[]): FitSummary {
  const counts = { runs_small: 0, true_to_size: 0, runs_large: 0 } as Record<FitFeedback, number>
  let count = 0

  for (const review of reviews) {
    const fit = review.fitFeedback
    if (fit === null || fit === undefined) continue
    if (!(FIT_FEEDBACK as readonly string[]).includes(fit)) continue

    counts[fit] += 1
    count += 1
  }

  return { count, counts, verdict: fitVerdict(counts, count) }
}

/**
 * The dominant answer, if there is one.
 *
 * Two gates, and both exist to stop the page saying something confident about nothing: a minimum
 * sample, and a clear majority. A 40/35/25 split is genuinely "opinions differ", and printing
 * "runs small" from it is worse than printing nothing — it sends people to the wrong size with the
 * shop's authority behind it.
 */
function fitVerdict(counts: Record<FitFeedback, number>, total: number): FitFeedback | null {
  if (total < MIN_FIT_SAMPLE) return null

  for (const fit of FIT_FEEDBACK) {
    if (counts[fit] / total >= FIT_MAJORITY) return fit
  }

  return null
}

/** The sentence a product page prints, or null when there is nothing worth saying. */
export function describeFit(summary: FitSummary): string | null {
  if (summary.verdict === null) return null

  switch (summary.verdict) {
    case 'runs_small':
      return 'Most people found this runs small — consider sizing up.'
    case 'runs_large':
      return 'Most people found this runs large — consider sizing down.'
    case 'true_to_size':
      return 'Most people found this true to size.'
  }
}

/** `4.3`, for rendering. The only place tenths become a decimal. */
export function formatAverage(summary: RatingSummary): string {
  return (summary.averageTenths / 10).toFixed(1)
}
