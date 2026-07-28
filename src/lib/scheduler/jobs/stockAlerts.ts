/**
 * Back-in-stock alerts.
 *
 * A wishlist row with `notifyOnRestock` is a standing subscription: "tell me when this variant —
 * this colour, this size — can be bought again". The job's whole job is to notice availability
 * crossing back above zero and to tell each watcher **once**.
 *
 * Two decisions worth stating.
 *
 * **Availability is `stockQty − reservedQty`, not `stockQty`,** and that is `availableQty` from the
 * catalog layer rather than the same arithmetic written again here. Alerting on stock that is
 * entirely reserved for other people's unpaid checkouts sends a hundred customers to a page that
 * says sold out.
 *
 * **Once means once, for good.** The subject key is the customer and the SKU, so a variant that
 * goes in and out of stock five times produces one message rather than five. That is a deliberate
 * trade: a repeat alert is defensible in theory and is spam in practice, and the customer who cared
 * has already been told.
 */
import type { Payload, Where } from 'payload'

import { availableQty } from '@/lib/catalog/variantView'
import { getDispatcher } from '@/lib/notify/factory'
import { emailRecipient } from '@/lib/notify/recipient'
import { relationshipId } from '@/lib/utils/ids'
import type { Job, JobContext, JobCounts } from '../types'

/** Just enough of a subscription to decide. */
export interface RestockSubscription {
  id: number
  customerId: number
  /** Where the alert would go. Null if the account has no address on it. */
  email: string | null
  /** For the greeting. */
  name?: string | null
  sku: string
  /** `stockQty − reservedQty`, floored at zero. */
  available: number
  notifyOnRestock: boolean
}

export type RestockSkip = 'not_subscribed' | 'still_out_of_stock' | 'no_contact'

export type RestockDecision =
  | { alert: true; subscription: RestockSubscription }
  | { alert: false; subscription: RestockSubscription; reason: RestockSkip }

export function decideRestockAlert(subscription: RestockSubscription): RestockDecision {
  if (!subscription.notifyOnRestock) return { alert: false, subscription, reason: 'not_subscribed' }
  if (subscription.available <= 0) return { alert: false, subscription, reason: 'still_out_of_stock' }

  const email = subscription.email?.trim() ?? ''
  if (email.length === 0) return { alert: false, subscription, reason: 'no_contact' }

  return { alert: true, subscription }
}

export interface RestockSelection {
  alert: RestockSubscription[]
  skipped: Record<RestockSkip, number>
}

export function selectRestockAlerts(subscriptions: readonly RestockSubscription[]): RestockSelection {
  const selection: RestockSelection = {
    alert: [],
    skipped: { not_subscribed: 0, still_out_of_stock: 0, no_contact: 0 },
  }

  for (const subscription of subscriptions) {
    const decision = decideRestockAlert(subscription)

    if (decision.alert) selection.alert.push(decision.subscription)
    else selection.skipped[decision.reason] += 1
  }

  return selection
}

/** The subject key for one watcher and one variant. Stable, and free of anything personal. */
export function restockSubject(customerId: number, sku: string): string {
  return `restock:${customerId}:${sku}`
}

// --- The port ---------------------------------------------------------------

async function loadSubscriptions(payload: Payload): Promise<RestockSubscription[]> {
  const { docs: rows } = await payload.find({
    collection: 'wishlists',
    where: { notifyOnRestock: { equals: true } } satisfies Where,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  if (rows.length === 0) return []

  const variantIds = [
    ...new Set(rows.map((row) => relationshipId(row.variant)).filter((id): id is number => id !== null)),
  ]
  const customerIds = [
    ...new Set(rows.map((row) => relationshipId(row.customer)).filter((id): id is number => id !== null)),
  ]

  const [{ docs: variants }, { docs: customers }] = await Promise.all([
    payload.find({
      collection: 'variants',
      where: { id: { in: variantIds } } satisfies Where,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'customers',
      where: { id: { in: customerIds } } satisfies Where,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
  ])

  const stock = new Map(variants.map((variant) => [variant.id, variant]))
  const contacts = new Map(
    customers.map((customer) => [
      customer.id,
      {
        email: typeof customer.email === 'string' ? customer.email : null,
        name: typeof customer.name === 'string' ? customer.name : null,
      },
    ]),
  )

  return rows.flatMap((row) => {
    const customerId = relationshipId(row.customer)
    const variantId = relationshipId(row.variant)

    // A row whose relationships are gone is skipped rather than counted: it is a data problem, not
    // a watcher who did not qualify, and folding it into the skip counts would misreport both.
    if (customerId === null || variantId === null) return []

    const variant = stock.get(variantId)
    if (variant === undefined) return []

    return [
      {
        id: row.id,
        customerId,
        email: contacts.get(customerId)?.email ?? null,
        name: contacts.get(customerId)?.name ?? null,
        sku: variant.sku,
        available: availableQty(variant.stockQty, variant.reservedQty),
        notifyOnRestock: row.notifyOnRestock === true,
      },
    ]
  })
}

export const stockAlertsJob: Job = {
  name: 'stock-alerts',
  description: 'Tell wishlist watchers when a variant is buyable again.',

  async run({ payload }: JobContext): Promise<JobCounts> {
    const subscriptions = await loadSubscriptions(payload)
    const selection = selectRestockAlerts(subscriptions)
    const notify = getDispatcher(payload)

    let notified = 0

    for (const subscription of selection.alert) {
      const recipient = emailRecipient({ email: subscription.email, name: subscription.name })
      if (recipient === null) continue

      const result = await notify.dispatch({
        event: 'stock.back_in_stock',
        recipient,
        subject: restockSubject(subscription.customerId, subscription.sku),
        variables: { sku: subscription.sku, available: subscription.available },
      })

      if (result.status === 'sent') notified += 1
    }

    return {
      examined: subscriptions.length,
      notified,
      ...selection.skipped,
    }
  },
}
