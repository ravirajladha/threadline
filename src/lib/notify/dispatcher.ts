/**
 * `dispatch(event, payload)` — the one way the shop says anything to anyone.
 *
 * Everything else in the codebase depends on this function and on `types.ts`, never on a channel.
 * That is what CLAUDE.md means by notifications being *a system*: adding WhatsApp at J11 is one new
 * class registered here, not an edit to every place that sends something.
 *
 * Four guarantees, and each is load-bearing:
 *
 * **It never throws.** Its callers are a checkout, a status transition and a cron job, and a
 * provider having a bad afternoon must not fail a customer's order. Every failure path returns a
 * `DispatchResult` and writes a row; nothing propagates. This is the rule the whole file is built
 * around, so the send is wrapped even though `NotificationChannel.send` already promises an outcome
 * rather than a throw — a promise a real SDK will break the first time its socket does.
 *
 * **It is idempotent by subject.** Absorbed from J5's `queue.ts`, unchanged in principle: the
 * `subject` identifies the *occasion* a message is about, it lives in the row's variables JSON, and
 * the log of what we sent is the only record consulted — one record rather than two that can drift.
 * A cron firing hourly therefore does not mail hourly.
 *
 * **The recipient is resolved by the caller from server-side data** and passed in whole, never
 * taken from a request body (OWASP A04). A dispatch that accepted an address from the wire would be
 * a way to post arbitrary mail through our domain.
 *
 * **Every send is recorded**, sent or failed, because the question this table exists to answer is
 * "I never received my shipping confirmation" and a log that only records successes cannot answer it.
 */
import type { Payload, Where } from 'payload'

import { isNotificationEvent, type NotificationEvent } from '@/types'
import { transactionReq } from '@/lib/utils/transaction'
import { renderNotification, templateKeyFor, type NotificationMessage } from './templates'
import type { DispatchResult, NotificationChannel, Recipient } from './types'

/**
 * One dispatch call.
 *
 * The event and its variables arrive as a correlated pair (`NotificationMessage`), so a caller
 * cannot supply `order.shipped` with an abandoned cart's variables — and a caller that decides the
 * event at runtime, as `statusNotification.ts` does, can still build one.
 */
export type DispatchInput = NotificationMessage & {
  recipient: Recipient
  /**
   * What this message is *about*, as a stable string — `order:260720-0003`,
   * `restock:5:TL-SHIRT-NAVY-M`. Two review requests for one customer are different messages; two
   * for one order are the same message sent twice, and the subject is what tells them apart.
   */
  subject: string
  /** Joins a caller's open transaction, so a notification rolls back with the order that caused it. */
  transactionID?: string | number | null
}

/** The shape written into `notifications.payload`, and read back out for the duplicate check. */
interface StoredVariables {
  subject?: unknown
  [key: string]: unknown
}

/**
 * Has a row already claimed this subject?
 *
 * Pure, so the matching rule is tested without a database — and it is exact equality on a string,
 * deliberately. Anything fuzzier ("starts with the order number") would make one order's message
 * suppress another's the day order numbers gain a suffix.
 */
export function claimsSubject(rows: readonly { payload?: unknown }[], subject: string): boolean {
  return rows.some((row) => {
    const stored = row.payload

    if (typeof stored !== 'object' || stored === null) return false

    return (stored as StoredVariables).subject === subject
  })
}

export interface DispatcherOptions {
  payload: Payload
  /**
   * The channels to try, in order. The first that can reach the recipient wins — email before
   * WhatsApp today, because email is the address every account has.
   */
  channels: readonly NotificationChannel[]
}

export function createDispatcher(options: DispatcherOptions) {
  const { payload, channels } = options

  /** Rows already written for this event and recipient. Both columns are indexed. */
  async function existingRows(
    event: NotificationEvent,
    recipient: string,
    transactionID: string | number | null,
  ): Promise<Array<{ payload?: unknown }>> {
    const { docs } = await payload.find({
      collection: 'notifications',
      where: {
        and: [{ event: { equals: event } }, { recipient: { equals: recipient } }],
      } satisfies Where,
      depth: 0,
      pagination: false,
      overrideAccess: true,
      ...transactionReq(transactionID),
    })

    return docs
  }

  async function writeRow(input: {
    event: NotificationEvent
    channel: NotificationChannel['name']
    recipient: string
    variables: Record<string, unknown>
    subject: string
    status: 'sent' | 'failed'
    providerId?: string
    error?: string
    transactionID: string | number | null
  }): Promise<void> {
    await payload.create({
      collection: 'notifications',
      data: {
        channel: input.channel,
        event: input.event,
        recipient: input.recipient,
        templateKey: templateKeyFor(input.event),
        // The subject rides with the template variables, which is what makes the duplicate check
        // possible without a second table — and why nothing personal may be added to either.
        payload: { subject: input.subject, ...input.variables },
        status: input.status,
        ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(input.status === 'sent' ? { sentAt: new Date().toISOString() } : {}),
      },
      depth: 0,
      overrideAccess: true,
      ...transactionReq(input.transactionID),
    })
  }

  return {
    /**
     * Send one message.
     *
     * Returns what happened and never throws. A caller that ignores the result is behaving
     * correctly — the result exists for tests and for jobs that want to count what they did.
     */
    async dispatch(input: DispatchInput): Promise<DispatchResult> {
      const { event, recipient, subject, transactionID = null } = input
      // Kept as a pair for rendering; spread flat into the stored variables.
      const variables: Record<string, unknown> = input.variables

      try {
        // Guarding an already-typed parameter is not paranoia here: `dispatch` is reachable from a
        // job that read an event name out of a row, and an unknown event would index into the
        // template table and throw where nothing is allowed to throw.
        if (!isNotificationEvent(event)) return { status: 'unreachable', event }

        const address = recipient.address.trim()
        const channel = channels.find((candidate) => candidate.canReach({ ...recipient, address }))

        // No channel can reach them. Not a failure — there is nothing to retry and nobody to tell,
        // and recording it as one would fill the log with rows nobody can act on.
        if (channel === undefined || address.length === 0) return { status: 'unreachable', event }

        const rows = await existingRows(event, address, transactionID)
        if (claimsSubject(rows, subject)) return { status: 'duplicate', event }

        const message = renderNotification(input, recipient.name ?? null)
        const outcome = await channel.send({ ...recipient, address }, message)

        await writeRow({
          event,
          channel: channel.name,
          recipient: address,
          variables,
          subject,
          status: outcome.ok ? 'sent' : 'failed',
          ...(outcome.ok ? { providerId: outcome.providerId } : { error: outcome.error }),
          transactionID,
        })

        if (!outcome.ok) {
          // Event, channel and subject — never the address, never the body (OWASP A09).
          payload.logger.warn({ event, channel: channel.name, subject, error: outcome.error }, 'Notification failed')

          return { status: 'failed', event, channel: channel.name, error: outcome.error }
        }

        return { status: 'sent', event, channel: channel.name, providerId: outcome.providerId }
      } catch (error) {
        // The outer boundary. Reaching here means the *database* failed, or a channel threw where
        // it promised not to. Either way an order must not fail because of it, so this swallows —
        // and says so loudly, because a silent swallow is how sending quietly stops working.
        payload.logger.error({ err: error, event, subject }, 'Notification dispatch failed')

        return {
          status: 'failed',
          event,
          channel: channels[0]?.name ?? 'email',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
  }
}

export type Dispatcher = ReturnType<typeof createDispatcher>
