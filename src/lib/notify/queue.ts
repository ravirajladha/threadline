/**
 * Writing a notification row, and knowing whether we already wrote it.
 *
 * J6 builds the dispatcher — one `notify.dispatch(event, payload)` with a channel behind it. Until
 * then the scheduler needs somewhere to put "we told this customer about this thing", and the
 * `notifications` collection already exists for exactly that. So this is the narrow half of the
 * dispatcher: it writes the row and answers the one question a scheduled job has to ask before it
 * writes another.
 *
 * **Idempotency comes from the log, not from a second table.** This is the same argument as
 * `orders/eventTrail.ts`: the record of what we sent *is* the notification row, so asking it
 * directly means there is one record of what happened rather than two that can drift apart. The
 * `subject` is the deterministic key for the thing a message is about — an order number for a
 * review request, a customer-and-SKU pair for a restock alert — and it lives in the row's `payload`
 * JSON, which is where the template variables already go.
 *
 * The narrowing query is on `event` and `recipient`, both indexed, and the subject is matched in
 * memory afterwards. A customer has a handful of rows per event, so this is a small read; matching
 * the JSON in SQL would tie the query to Postgres JSON operators for no gain at this size.
 */
import type { Payload, Where } from 'payload'

import type { NotificationChannel } from '@/types'

export interface NotificationRequest {
  /** The dispatched event name — `order.review_request`, `cart.abandoned`. */
  event: string
  channel: NotificationChannel
  /** Email address or phone number. Never logged (OWASP A09). */
  recipient: string
  templateKey: string
  /**
   * What this message is *about*, as a stable string.
   *
   * Two review requests for one customer are different messages; two for one order are the same
   * message sent twice. The subject is what makes that distinction, so it must identify the
   * occasion and not the person.
   */
  subject: string
  /** Template variables. Nothing secret, no full address, no tokens. */
  variables?: Record<string, unknown>
}

/** The shape this module writes into `notifications.payload`, and reads back out. */
interface NotificationPayload {
  subject?: unknown
  [key: string]: unknown
}

/**
 * Has a row in `rows` already claimed this subject?
 *
 * Pure, so the matching rule is tested without a database — and the rule is exact equality on a
 * string, deliberately. Anything fuzzier ("starts with the order number") would make one order's
 * notification suppress another's the day order numbers gain a suffix.
 */
export function claimsSubject(rows: readonly { payload?: unknown }[], subject: string): boolean {
  return rows.some((row) => {
    const body = row.payload

    if (typeof body !== 'object' || body === null) return false

    return (body as NotificationPayload).subject === subject
  })
}

/** Whether this exact message has already been queued for this recipient. */
export async function alreadyQueued(
  payload: Payload,
  input: Pick<NotificationRequest, 'event' | 'recipient' | 'subject'>,
): Promise<boolean> {
  const { docs } = await payload.find({
    collection: 'notifications',
    where: {
      and: [{ event: { equals: input.event } }, { recipient: { equals: input.recipient } }],
    } satisfies Where,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  return claimsSubject(docs, input.subject)
}

/**
 * Queue a notification, unless it has already been queued.
 *
 * Returns whether a row was written, so a job can count what it actually did rather than what it
 * considered. Status is `queued` and nothing is sent: J6's channels do the sending, and a row that
 * is never picked up is a visible backlog rather than a silently dropped message.
 */
export async function queueNotification(payload: Payload, request: NotificationRequest): Promise<boolean> {
  // Every caller's decision already guarantees a recipient; this is the guard for the day one of
  // them stops. A row with an empty recipient is a message that can never be delivered and never be
  // explained, and it would sit in the log looking like a send that happened.
  if (request.recipient.trim().length === 0) return false

  if (await alreadyQueued(payload, request)) return false

  await payload.create({
    collection: 'notifications',
    data: {
      channel: request.channel,
      event: request.event,
      recipient: request.recipient,
      templateKey: request.templateKey,
      payload: { subject: request.subject, ...(request.variables ?? {}) },
      status: 'queued',
    },
    depth: 0,
    overrideAccess: true,
  })

  return true
}
