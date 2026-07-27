/**
 * Loyalty points.
 *
 * The rules, from `docs/SCHEMA.md`: 1 point earned per ₹1 of subtotal, 1 point worth ₹1 when
 * redeemed, no more than a percentage of the cart may be paid with points, and there is a
 * minimum worth redeeming at all. All four numbers come from `settings`.
 *
 * Points are whole. A points balance is a count, not money, so the conversion always rounds
 * **down** — a customer with 149 points redeems ₹149 and keeps the remainder, rather than
 * being credited a fraction of a point that then cannot be spent or reversed cleanly.
 */
import { Money } from './money'

/** The loyalty half of `settings`. */
export interface LoyaltyRules {
  enabled: boolean
  /** Points per ₹1 of subtotal, awarded on delivery. */
  earnPerRupee: number
  /** The most of a cart points may pay for, as a percentage. */
  maxRedeemPct: number
  /** Fewest points that may be redeemed in one order. */
  minRedeem: number
}

export const LOYALTY_REJECTIONS = ['disabled', 'below_minimum', 'insufficient_balance'] as const
export type LoyaltyRejection = (typeof LOYALTY_REJECTIONS)[number]

/** 1 point = ₹1. */
export function pointsToMoney(points: number): Money {
  if (!Number.isInteger(points) || points < 0) {
    throw new RangeError(`Points must be a non-negative whole number, received ${points}`)
  }

  return Money.fromRupees(points)
}

/** Whole points in an amount, rounded down. */
export function moneyToPoints(amount: Money): number {
  return Math.max(0, Math.floor(amount.toRupees()))
}

/** Points earned by an order, awarded on delivery. */
export function pointsEarned(subtotal: Money, rules: LoyaltyRules): number {
  if (!rules.enabled) return 0

  return Math.max(0, Math.floor(subtotal.toRupees() * rules.earnPerRupee))
}

/**
 * The most points this customer could spend on this cart.
 *
 * Three ceilings, and the lowest wins: their balance, the owner's percentage cap, and what is
 * actually left to pay. Returns 0 rather than a number below the minimum, because offering to
 * redeem 30 points when the minimum is 50 is an error message waiting to happen.
 */
export function maxRedeemablePoints(input: {
  balance: number
  /** What points may be applied to — the subtotal after any coupon. */
  redeemableAgainst: Money
  rules: LoyaltyRules
}): number {
  const { balance, redeemableAgainst, rules } = input

  if (!rules.enabled) return 0
  if (balance <= 0) return 0

  const percentageCap = moneyToPoints(redeemableAgainst.percentage(rules.maxRedeemPct))
  const allowed = Math.min(balance, percentageCap, moneyToPoints(redeemableAgainst))

  return allowed >= rules.minRedeem ? allowed : 0
}

export type LoyaltyRedemption =
  | { ok: true; points: number; discount: Money }
  | { ok: false; reason: LoyaltyRejection }

/**
 * Redeem a requested number of points.
 *
 * A request above what is allowed is **clamped, not refused** — the customer asking for more
 * than the cap should get the cap, which is what they meant. The two real refusals are asking
 * for fewer points than the minimum and not having them in the first place.
 *
 * Requesting zero is a success worth zero: it is the normal state of a checkout where nobody
 * touched the points box.
 */
export function redeemPoints(input: {
  requestedPoints: number
  balance: number
  redeemableAgainst: Money
  rules: LoyaltyRules
}): LoyaltyRedemption {
  const { requestedPoints, balance, redeemableAgainst, rules } = input

  if (requestedPoints <= 0) return { ok: true, points: 0, discount: Money.zero() }
  if (!rules.enabled) return { ok: false, reason: 'disabled' }
  if (requestedPoints > balance) return { ok: false, reason: 'insufficient_balance' }
  if (requestedPoints < rules.minRedeem) return { ok: false, reason: 'below_minimum' }

  const cap = maxRedeemablePoints({ balance, redeemableAgainst, rules })
  if (cap === 0) return { ok: false, reason: 'below_minimum' }

  const points = Math.min(requestedPoints, cap)

  return { ok: true, points, discount: pointsToMoney(points) }
}

export function loyaltyRejectionMessage(reason: LoyaltyRejection, rules: LoyaltyRules): string {
  switch (reason) {
    case 'disabled':
      return 'Points cannot be redeemed at the moment.'
    case 'below_minimum':
      return `You need at least ${rules.minRedeem} points to redeem on this order.`
    case 'insufficient_balance':
      return 'You do not have that many points.'
  }
}
