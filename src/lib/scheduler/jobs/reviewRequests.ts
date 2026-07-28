/**
 * Asking for a review, once, at the right moment.
 *
 * The window has two edges and both matter. Ask **too early** and the parcel has been delivered to a
 * neighbour, or opened and not tried on, and the honest answer is "I don't know yet". Ask **too
 * late** and it reads as a shop that has lost track of its own orders — and for clothing the answer
 * has usually already been given, by keeping it or returning it.
 *
 * Idempotency is the order number as the subject key in the notification log, not a flag on the
 * order. That keeps J5 free of a migration, and it follows the same principle as `eventTrail.ts`:
 * the record of what we sent is the notification row, so there is one record rather than two that
 * can disagree.
 */
import type { Payload, Where } from 'payload'

import { getDispatcher } from '@/lib/notify/factory'
import { emailRecipient } from '@/lib/notify/recipient'
import { relationshipId } from '@/lib/utils/ids'
import type { OrderStatus } from '@/types'
import type { Job, JobContext, JobCounts } from '../types'

export interface ReviewRequestRules {
  /** Days after delivery before asking. */
  afterDays: number
  /** Days after delivery past which the moment has gone. */
  windowDays: number
}

export const REVIEW_REQUEST_RULES: ReviewRequestRules = Object.freeze({ afterDays: 5, windowDays: 30 })

/** Just enough of an order to decide. */
export interface ReviewCandidate {
  orderNumber: string
  status: OrderStatus
  email: string | null
  /** For the greeting. An order carries no name of its own, so this comes from the customer. */
  name?: string | null
  /** When the courier delivered it. ISO, or null if the status arrived without a timestamp. */
  deliveredAt: string | null
}

export type ReviewSkip = 'not_delivered' | 'no_delivery_date' | 'too_soon' | 'window_passed' | 'no_contact'

export type ReviewDecision =
  | { ask: true; order: ReviewCandidate }
  | { ask: false; order: ReviewCandidate; reason: ReviewSkip }

const DAY_MS = 86_400_000

export function decideReviewRequest(
  order: ReviewCandidate,
  now: Date,
  rules: ReviewRequestRules = REVIEW_REQUEST_RULES,
): ReviewDecision {
  // Only a delivered order. A returned or refunded one has had its answer, and asking for a rating
  // on a parcel that came back is the worst message a shop can send.
  if (order.status !== 'delivered') return { ask: false, order, reason: 'not_delivered' }

  const deliveredAt = order.deliveredAt === null ? NaN : Date.parse(order.deliveredAt)
  if (Number.isNaN(deliveredAt)) return { ask: false, order, reason: 'no_delivery_date' }

  const email = order.email?.trim() ?? ''
  if (email.length === 0) return { ask: false, order, reason: 'no_contact' }

  const age = now.getTime() - deliveredAt

  if (age < rules.afterDays * DAY_MS) return { ask: false, order, reason: 'too_soon' }
  if (age > rules.windowDays * DAY_MS) return { ask: false, order, reason: 'window_passed' }

  return { ask: true, order }
}

export interface ReviewSelection {
  ask: ReviewCandidate[]
  skipped: Record<ReviewSkip, number>
}

export function selectReviewRequests(
  orders: readonly ReviewCandidate[],
  now: Date,
  rules: ReviewRequestRules = REVIEW_REQUEST_RULES,
): ReviewSelection {
  const selection: ReviewSelection = {
    ask: [],
    skipped: { not_delivered: 0, no_delivery_date: 0, too_soon: 0, window_passed: 0, no_contact: 0 },
  }

  for (const order of orders) {
    const decision = decideReviewRequest(order, now, rules)

    if (decision.ask) selection.ask.push(decision.order)
    else selection.skipped[decision.reason] += 1
  }

  return selection
}

// --- The port ---------------------------------------------------------------

/**
 * Delivered orders inside the widest window the rules could use.
 *
 * Bounded by date in SQL so the job does not read every order the shop has ever delivered, then
 * decided precisely in `decideReviewRequest` — the query narrows, the pure function judges.
 */
async function loadCandidates(
  payload: Payload,
  now: Date,
  rules: ReviewRequestRules,
): Promise<ReviewCandidate[]> {
  const earliest = new Date(now.getTime() - rules.windowDays * DAY_MS).toISOString()

  const { docs } = await payload.find({
    collection: 'orders',
    where: {
      and: [{ status: { equals: 'delivered' } }, { deliveredAt: { greater_than_equal: earliest } }],
    } satisfies Where,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  // An order carries the email it was placed with but no name — that lives on the account, and a
  // guest order has none. Resolved in one query for the batch rather than one per order.
  const customerIds = [
    ...new Set(docs.map((order) => relationshipId(order.customer)).filter((id): id is number => id !== null)),
  ]

  const names = new Map<number, string | null>()

  if (customerIds.length > 0) {
    const { docs: customers } = await payload.find({
      collection: 'customers',
      where: { id: { in: customerIds } } satisfies Where,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })

    for (const customer of customers) {
      names.set(customer.id, typeof customer.name === 'string' ? customer.name : null)
    }
  }

  return docs.map((order) => {
    const customerId = relationshipId(order.customer)

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      email: typeof order.email === 'string' ? order.email : null,
      name: customerId === null ? null : (names.get(customerId) ?? null),
      deliveredAt: typeof order.deliveredAt === 'string' ? order.deliveredAt : null,
    }
  })
}

export const reviewRequestsJob: Job = {
  name: 'review-requests',
  description: 'Ask for a review a few days after delivery.',

  async run({ payload, now }: JobContext): Promise<JobCounts> {
    const candidates = await loadCandidates(payload, now, REVIEW_REQUEST_RULES)
    const selection = selectReviewRequests(candidates, now)
    const notify = getDispatcher(payload)

    let notified = 0

    for (const order of selection.ask) {
      const recipient = emailRecipient({ email: order.email, name: order.name })
      if (recipient === null) continue

      const result = await notify.dispatch({
        event: 'order.review_request',
        recipient,
        // The order number, which is a date and a sequence — no PII, and unique per occasion.
        subject: `order:${order.orderNumber}`,
        variables: { orderNumber: order.orderNumber },
      })

      if (result.status === 'sent') notified += 1
    }

    return {
      examined: candidates.length,
      notified,
      ...selection.skipped,
    }
  },
}
