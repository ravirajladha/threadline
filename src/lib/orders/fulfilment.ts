/**
 * Which fulfilment actions an order allows, and why the others are refused.
 *
 * The admin needs to render three buttons — pack, ship, mark delivered — and each is either
 * available or not. The naive version puts `order.status === 'confirmed'` in the component, and then
 * the endpoint repeats the same condition in slightly different words, and the day the status machine
 * changes the two disagree. So the decision lives here, once, and both the UI and the endpoint ask it
 * (CLAUDE.md §2 — components render, `lib/` decides).
 *
 * **A refusal carries a typed reason, not a `false`.** "Ship" being greyed out is useless on its own;
 * "this order has not been packed yet" is actionable, and "this order was cancelled" tells staff to
 * stop looking. This mirrors `pricing/coupon.ts`, where the same argument applies to a customer.
 *
 * Nothing here restates the status graph. `transitions.ts` owns which moves are legal and this asks
 * it, so an edit there cannot leave this file quietly out of date. What this adds is the *extra*
 * conditions a fulfilment action has beyond the transition being legal — chiefly that a parcel cannot
 * be shipped before a courier has given us an AWB.
 */
import type { OrderStatus } from '@/types'
import { canTransition } from './transitions'

export const FULFILMENT_ACTIONS = ['pack', 'ship', 'deliver'] as const
export type FulfilmentAction = (typeof FULFILMENT_ACTIONS)[number]

/** The status each action moves an order to. */
export const FULFILMENT_TARGET: Readonly<Record<FulfilmentAction, OrderStatus>> = Object.freeze({
  pack: 'packed',
  ship: 'shipped',
  deliver: 'delivered',
})

export type FulfilmentRefusal =
  /** The status graph forbids it — the order is behind, ahead, or finished. */
  | { reason: 'illegal_transition'; from: OrderStatus; to: OrderStatus }
  /** Legal, but there is no parcel to ship yet. */
  | { reason: 'no_awb' }
  /** Payment has not arrived and this is not a cash-on-delivery order. */
  | { reason: 'unpaid' }

export type FulfilmentDecision =
  | { allowed: true; action: FulfilmentAction; toStatus: OrderStatus }
  | ({ allowed: false; action: FulfilmentAction } & FulfilmentRefusal)

/** Just enough of an order to decide. Deliberately not the Payload document. */
export interface FulfilmentState {
  status: OrderStatus
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded'
  paymentMethod: 'razorpay' | 'cod'
  /** Null until a courier has booked the parcel. */
  awbCode: string | null
}

/**
 * Whether one action is available.
 *
 * The order of the checks is deliberate: the transition is tested first, so an order that is
 * cancelled reports `illegal_transition` rather than `no_awb`. The most fundamental reason is the
 * most useful one to show, and "this order needs an AWB" would be actively misleading on an order
 * nobody should be fulfilling at all.
 */
export function evaluateFulfilment(state: FulfilmentState, action: FulfilmentAction): FulfilmentDecision {
  const toStatus = FULFILMENT_TARGET[action]

  if (!canTransition(state.status, toStatus)) {
    return { allowed: false, action, reason: 'illegal_transition', from: state.status, to: toStatus }
  }

  // Packing a prepaid order that has not been paid for would be picking stock against money that
  // never arrived. A COD order is expected to be unpaid until the doorstep, so the rule applies to
  // prepaid orders only — and it is checked at `pack`, the first point real work is done.
  if (action === 'pack' && state.paymentMethod !== 'cod' && state.paymentStatus !== 'paid') {
    return { allowed: false, action, reason: 'unpaid' }
  }

  // The condition the status graph cannot express: `packed → shipped` is a legal move, but handing a
  // parcel over means a courier has accepted it and issued a tracking number. Shipping without one
  // gives the customer a status change and nothing to track.
  if (action === 'ship' && (state.awbCode === null || state.awbCode.trim().length === 0)) {
    return { allowed: false, action, reason: 'no_awb' }
  }

  return { allowed: true, action, toStatus }
}

/**
 * Every action, decided at once.
 *
 * What the admin order view renders from. Returning all three — refusals included — rather than only
 * the permitted ones is what lets the UI explain a disabled button instead of hiding it, the same
 * reasoning as showing a sold-out size struck through in J3.
 */
export function fulfilmentOptions(state: FulfilmentState): FulfilmentDecision[] {
  return FULFILMENT_ACTIONS.map((action) => evaluateFulfilment(state, action))
}

/** A short, staff-facing sentence for a refusal. Kept beside the reasons so one cannot outlive the other. */
export function describeRefusal(refusal: FulfilmentRefusal): string {
  switch (refusal.reason) {
    case 'illegal_transition':
      return `An order cannot go from ${refusal.from.replace(/_/g, ' ')} to ${refusal.to.replace(/_/g, ' ')}.`
    case 'no_awb':
      return 'Book a courier first — there is no tracking number for this order yet.'
    case 'unpaid':
      return 'Payment has not been received for this order yet.'
  }
}
