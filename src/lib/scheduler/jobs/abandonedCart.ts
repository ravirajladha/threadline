/**
 * Abandoned carts — who is worth reminding, and who is not.
 *
 * The decision is pure and the port is thin, because the interesting part is not the query. It is
 * the four ways a cart can look abandoned and not be:
 *
 * - **Too recent.** A cart idle for ten minutes is a customer still shopping. Mailing them is the
 *   single fastest way to teach people to ignore your emails.
 * - **Too old.** A cart nobody has touched for a fortnight is not a recoverable sale, it is a
 *   backlog item that would arrive as a message about a thing they no longer want.
 * - **Already told.** `carts.abandonedNotifiedAt` exists for this, and without checking it an
 *   hourly cron sends an hourly email.
 * - **Nowhere to send it.** A guest cart has a session id and no address.
 *
 * Each is a *counted* skip rather than a silent filter, so the job's result says why 117 of 120
 * carts were passed over.
 */
import type { Payload, Where } from 'payload'

import { getDispatcher } from '@/lib/notify/factory'
import { emailRecipient } from '@/lib/notify/recipient'
import { relationshipId } from '@/lib/utils/ids'
import type { Job, JobContext, JobCounts } from '../types'

export interface AbandonedCartRules {
  /** How long a cart must sit untouched before it counts as abandoned. */
  idleMinutes: number
  /** Past this, the sale is gone and a reminder is just noise. */
  maxAgeHours: number
}

/** Six hours idle, given up on after three days. Both are owner-tunable if they ever move to settings. */
export const ABANDONED_CART_RULES: AbandonedCartRules = Object.freeze({
  idleMinutes: 6 * 60,
  maxAgeHours: 72,
})

/** Just enough of a cart to decide. Not the Payload document. */
export interface AbandonedCartCandidate {
  id: number
  /** Where a reminder would go. Null for a guest with no account. */
  email: string | null
  /** For the greeting. Null is fine — the template falls back. */
  name?: string | null
  itemCount: number
  /** Last touched. ISO. */
  updatedAt: string
  /** Null until a reminder has been sent for this cart. */
  abandonedNotifiedAt: string | null
}

export type AbandonedCartSkip = 'empty' | 'no_contact' | 'too_recent' | 'too_old' | 'already_notified'

export type AbandonedCartDecision =
  | { send: true; cart: AbandonedCartCandidate }
  | { send: false; cart: AbandonedCartCandidate; reason: AbandonedCartSkip }

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Milliseconds since `iso`, or null when it is not a date we can reason about. */
function ageMs(iso: string, now: Date): number | null {
  const at = Date.parse(iso)

  return Number.isNaN(at) ? null : now.getTime() - at
}

export function decideAbandonedCart(
  cart: AbandonedCartCandidate,
  now: Date,
  rules: AbandonedCartRules = ABANDONED_CART_RULES,
): AbandonedCartDecision {
  if (cart.itemCount <= 0) return { send: false, cart, reason: 'empty' }
  if (cart.abandonedNotifiedAt !== null) return { send: false, cart, reason: 'already_notified' }

  const email = cart.email?.trim() ?? ''
  if (email.length === 0) return { send: false, cart, reason: 'no_contact' }

  const age = ageMs(cart.updatedAt, now)

  // An unparseable timestamp is treated as too recent, not as ancient. Failing towards *not*
  // mailing someone is the only safe direction for a job that sends messages.
  if (age === null) return { send: false, cart, reason: 'too_recent' }

  if (age < rules.idleMinutes * MINUTE_MS) return { send: false, cart, reason: 'too_recent' }
  if (age > rules.maxAgeHours * HOUR_MS) return { send: false, cart, reason: 'too_old' }

  return { send: true, cart }
}

export interface AbandonedCartSelection {
  send: AbandonedCartCandidate[]
  skipped: Record<AbandonedCartSkip, number>
}

export function selectAbandonedCarts(
  carts: readonly AbandonedCartCandidate[],
  now: Date,
  rules: AbandonedCartRules = ABANDONED_CART_RULES,
): AbandonedCartSelection {
  const selection: AbandonedCartSelection = {
    send: [],
    skipped: { empty: 0, no_contact: 0, too_recent: 0, too_old: 0, already_notified: 0 },
  }

  for (const cart of carts) {
    const decision = decideAbandonedCart(cart, now, rules)

    if (decision.send) selection.send.push(decision.cart)
    else selection.skipped[decision.reason] += 1
  }

  return selection
}

// --- The port ---------------------------------------------------------------

/** Read the carts that could possibly qualify, with the customer's email resolved. */
async function loadCandidates(payload: Payload): Promise<AbandonedCartCandidate[]> {
  const { docs } = await payload.find({
    collection: 'carts',
    // Only carts belonging to someone we can contact. A guest cart is left alone here rather than
    // fetched and skipped, because there is no volume of them worth reading.
    where: { customer: { exists: true } } satisfies Where,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const customerIds = [
    ...new Set(docs.map((cart) => relationshipId(cart.customer)).filter((id): id is number => id !== null)),
  ]

  const contacts = new Map<number, { email: string | null; name: string | null }>()

  if (customerIds.length > 0) {
    const { docs: customers } = await payload.find({
      collection: 'customers',
      where: { id: { in: customerIds } } satisfies Where,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })

    for (const customer of customers) {
      contacts.set(customer.id, {
        email: typeof customer.email === 'string' ? customer.email : null,
        name: typeof customer.name === 'string' ? customer.name : null,
      })
    }
  }

  return docs.map((cart) => {
    const customerId = relationshipId(cart.customer)
    const contact = customerId === null ? undefined : contacts.get(customerId)

    return {
      id: cart.id,
      email: contact?.email ?? null,
      name: contact?.name ?? null,
      itemCount: Array.isArray(cart.items) ? cart.items.length : 0,
      updatedAt: cart.updatedAt,
      abandonedNotifiedAt: typeof cart.abandonedNotifiedAt === 'string' ? cart.abandonedNotifiedAt : null,
    }
  })
}

export const abandonedCartJob: Job = {
  name: 'abandoned-cart',
  description: 'Remind customers who left items in their cart.',

  async run({ payload, now }: JobContext): Promise<JobCounts> {
    const candidates = await loadCandidates(payload)
    const selection = selectAbandonedCarts(candidates, now)
    const notify = getDispatcher(payload)

    let notified = 0

    for (const cart of selection.send) {
      const recipient = emailRecipient({ email: cart.email, name: cart.name })
      if (recipient === null) continue

      // The address is the recipient, never the subject: the subject identifies the *occasion*, and
      // a customer can abandon more than one cart over a lifetime.
      const result = await notify.dispatch({
        event: 'cart.abandoned',
        recipient,
        subject: `cart:${cart.id}`,
        variables: { itemCount: cart.itemCount },
      })

      // Stamped whatever the dispatcher decided. If the log already held this message, the cart was
      // reminded and the marker is simply catching up; if the send failed, retrying it tomorrow
      // would mean a customer whose provider is bouncing gets chased daily. Either way it must not
      // be considered again.
      await payload.update({
        collection: 'carts',
        id: cart.id,
        data: { abandonedNotifiedAt: now.toISOString() },
        depth: 0,
        overrideAccess: true,
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
