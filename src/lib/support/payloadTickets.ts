/**
 * The Payload-backed support port — raising a request, replying to it, and working the queue.
 *
 * Two kinds of caller reach this, and the difference between them is the whole security model:
 *
 * - **A customer** may raise a ticket, read their own, and reply to their own. Every one of those
 *   is scoped by the customer id resolved from the *session*, never from the request. A ticket
 *   number is a reference, not a credential (`ticketNumber.ts`), so looking one up always checks
 *   the owner as well — a customer quoting a stranger's reference gets "not found", which is both
 *   the safe answer and the honest one.
 * - **An agent** may read the queue, reply, assign and set status, gated on `support` write. Note
 *   that `support_agent` has `orders: read` in the role matrix, so nothing here can be used as a
 *   way round that — this port touches tickets and nothing else.
 *
 * The message body is stored as text and rendered as text (OWASP A03). Nothing here builds HTML,
 * and nothing downstream may pass a ticket body to `dangerouslySetInnerHTML`.
 */
import type { Payload, Where } from 'payload'

import { canWrite, customerIdOf, staffIdOf, staffRoleOf } from '@/access'
import { getDispatcher } from '@/lib/notify/factory'
import { emailRecipient } from '@/lib/notify/recipient'
import type { Ticket } from '@/payload-types'
import { numericId, relationshipId } from '@/lib/utils/ids'
import { transactionReq, withTransaction } from '@/lib/utils/transaction'
import { appendMessage, type ThreadMessage, type ThreadRefusal } from './thread'
import { buildTicketNumber, ticketDatePrefix } from './ticketNumber'
import { assertTicketTransition } from './transitions'
import type { MessageAuthorType, TicketCategory, TicketStatus } from '@/types'

/** The display name shown on an agent's message. Never the agent's email. */
const AGENT_DISPLAY_NAME = 'Threadline Support'

export type TicketFailure =
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; detail: ThreadRefusal | 'no_subject' | 'bad_status' }

export type RaiseResult = { ok: true; ticketNumber: string; id: number } | TicketFailure
export type ReplyResult = { ok: true; ticketNumber: string; message: ThreadMessage } | TicketFailure
export type TicketUpdateResult = { ok: true; ticketNumber: string } | TicketFailure

export interface PayloadTicketsOptions {
  payload: Payload
  /** Injected so a test asserts what was sent. Omitted, the configured channels are used. */
  notify?: ReturnType<typeof getDispatcher> | null
}

export function createPayloadTickets(options: PayloadTicketsOptions) {
  const { payload } = options

  let dispatcher = options.notify

  function notifier(): ReturnType<typeof getDispatcher> | null {
    if (dispatcher === undefined) dispatcher = getDispatcher(payload)

    return dispatcher
  }

  /** How many tickets exist for a day, so the next sequence can be computed. */
  async function nextSequence(datePrefix: string, transactionID: string | number | null): Promise<number> {
    const { totalDocs } = await payload.count({
      collection: 'tickets',
      where: { ticketNumber: { like: `${datePrefix}%` } } satisfies Where,
      overrideAccess: true,
      ...transactionReq(transactionID),
    })

    return totalDocs + 1
  }

  /**
   * A ticket by number, **and** the check that this caller may see it.
   *
   * One function rather than a lookup plus a separate guard, because the two drifting apart is
   * precisely how a reference becomes a credential. Staff with `support` read see any ticket; a
   * customer sees only their own; everyone else sees nothing.
   */
  async function findForActor(
    ticketNumber: string,
    user: unknown,
    transactionID: string | number | null = null,
  ): Promise<Ticket | null> {
    const { docs } = await payload.find({
      collection: 'tickets',
      where: { ticketNumber: { equals: ticketNumber } } satisfies Where,
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: true,
      ...transactionReq(transactionID),
    })

    const ticket = (docs[0] as Ticket | undefined) ?? null
    if (ticket === null) return null

    if (canWrite(staffRoleOf(user), 'support')) return ticket

    const customerId = customerIdOf(user)
    if (customerId === null) return null

    // Compared as numbers, because `req.user.id` may arrive as a string from a token while the
    // relationship is an integer — and a `===` between those is silently always false, which would
    // deny every customer their own ticket.
    return relationshipId(ticket.customer) === numericId(customerId) ? ticket : null
  }

  /** Tell the customer an agent has replied. Failures never block the reply itself. */
  async function notifyCustomer(
    ticket: Ticket,
    event: 'ticket.replied' | 'ticket.resolved',
    transactionID: string | number | null,
  ): Promise<void> {
    const notify = notifier()
    if (notify === null) return

    const customerId = relationshipId(ticket.customer)
    if (customerId === null) return

    try {
      const customer = await payload.findByID({
        collection: 'customers',
        id: customerId,
        depth: 0,
        overrideAccess: true,
        ...transactionReq(transactionID),
      })

      const recipient = emailRecipient({
        email: typeof customer.email === 'string' ? customer.email : null,
        name: typeof customer.name === 'string' ? customer.name : null,
      })
      if (recipient === null) return

      await notify.dispatch({
        event,
        variables: { ticketNumber: ticket.ticketNumber, subject: ticket.subject },
        recipient,
        // The message count makes each reply its own occasion — otherwise the second reply on a
        // thread would be suppressed as a duplicate of the first.
        subject: `ticket:${ticket.ticketNumber}:${event}:${ticket.messages?.length ?? 0}`,
        transactionID,
      })
    } catch (error) {
      payload.logger.error({ err: error, ticketNumber: ticket.ticketNumber }, 'Ticket notification failed')
    }
  }

  return {
    /**
     * Raise a request.
     *
     * The customer comes from the session. An `order` is accepted only if it belongs to the same
     * customer — otherwise attaching a stranger's order id to your own ticket would put their order
     * number in front of an agent as though it were yours (OWASP A01).
     */
    async raise(input: {
      user: unknown
      subject: string
      body: string
      category: TicketCategory
      orderId?: number | string | null
      now?: Date
    }): Promise<RaiseResult> {
      const { user, subject, body, category, orderId = null, now = new Date() } = input

      const customerId = customerIdOf(user)
      if (customerId === null) return { ok: false, reason: 'forbidden' }

      const trimmedSubject = subject.trim()
      if (trimmedSubject.length === 0) return { ok: false, reason: 'invalid', detail: 'no_subject' }

      // The opening message goes through the same rules as any reply — length, emptiness — so a
      // ticket cannot be raised with a body a reply would have been refused for.
      const opening = appendMessage({
        state: { status: 'open', firstResponseAt: null },
        authorType: 'customer',
        author: 'You',
        body,
        now,
      })

      if (!opening.ok) return { ok: false, reason: 'invalid', detail: opening.reason }

      return withTransaction(payload, async (transactionID) => {
        const req = transactionReq(transactionID)
        const probe = buildTicketNumber({ date: now, sequence: 1 })
        const sequence = await nextSequence(ticketDatePrefix(probe), transactionID)
        const ticketNumber = buildTicketNumber({ date: now, sequence })

        let order: number | null = null

        if (orderId !== null) {
          const owned = await payload.find({
            collection: 'orders',
            where: {
              and: [{ id: { equals: numericId(orderId) } }, { customer: { equals: numericId(customerId) } }],
            } satisfies Where,
            depth: 0,
            limit: 1,
            pagination: false,
            overrideAccess: true,
            ...req,
          })

          // Silently dropped rather than refused: the request itself is legitimate, and the
          // attachment is a convenience. Refusing would tell a prober which order ids exist.
          order = owned.docs[0] === undefined ? null : numericId(orderId)
        }

        const created = (await payload.create({
          collection: 'tickets',
          data: {
            ticketNumber,
            customer: numericId(customerId),
            ...(order === null ? {} : { order }),
            subject: trimmedSubject,
            category,
            status: 'open',
            priority: 'normal',
            messages: [opening.message],
          },
          depth: 0,
          overrideAccess: true,
          ...req,
        })) as Ticket

        payload.logger.info({ ticketNumber, category }, 'Support ticket raised')

        return { ok: true, ticketNumber, id: created.id }
      })
    },

    /**
     * Append a reply.
     *
     * One method for both sides, because the rules are the same and the *only* differences —
     * who may, what display name is shown, which status the reply implies — are already data.
     * Two methods would be two places for the ownership check to be got wrong.
     */
    async reply(input: { user: unknown; ticketNumber: string; body: string; now?: Date }): Promise<ReplyResult> {
      const { user, ticketNumber, body, now = new Date() } = input

      const isAgent = canWrite(staffRoleOf(user), 'support')
      const customerId = customerIdOf(user)

      if (!isAgent && customerId === null) return { ok: false, reason: 'forbidden' }

      return withTransaction(payload, async (transactionID) => {
        const ticket = await findForActor(ticketNumber, user, transactionID)
        if (ticket === null) return { ok: false, reason: 'not_found' } as const

        const authorType: MessageAuthorType = isAgent ? 'agent' : 'customer'

        const appended = appendMessage({
          state: {
            status: ticket.status,
            firstResponseAt: typeof ticket.firstResponseAt === 'string' ? ticket.firstResponseAt : null,
          },
          authorType,
          // Server-resolved, never from the body — a caller choosing their own display name could
          // post a message that reads as though support wrote it (OWASP A04).
          author: isAgent ? AGENT_DISPLAY_NAME : 'You',
          body,
          now,
        })

        if (!appended.ok) return { ok: false, reason: 'invalid', detail: appended.reason } as const

        await payload.update({
          collection: 'tickets',
          id: ticket.id,
          data: {
            messages: [...(ticket.messages ?? []), appended.message],
            ...(appended.effect.toStatus === null ? {} : { status: appended.effect.toStatus }),
            ...(appended.effect.firstResponseAt === null
              ? {}
              : { firstResponseAt: appended.effect.firstResponseAt }),
          },
          depth: 0,
          overrideAccess: true,
          ...transactionReq(transactionID),
        })

        // Only an agent's reply is worth an email. Telling a customer about their own message is
        // the kind of notification that teaches people to ignore notifications.
        if (isAgent) {
          await notifyCustomer(
            { ...ticket, messages: [...(ticket.messages ?? []), appended.message] },
            'ticket.replied',
            transactionID,
          )
        }

        payload.logger.info({ ticketNumber, authorType }, 'Support reply appended')

        return { ok: true, ticketNumber, message: appended.message } as const
      })
    },

    /** Move a ticket's status. Staff only, and validated by the machine. */
    async setStatus(input: {
      user: unknown
      ticketNumber: string
      toStatus: TicketStatus
      now?: Date
    }): Promise<TicketUpdateResult> {
      const { user, ticketNumber, toStatus, now = new Date() } = input

      if (!canWrite(staffRoleOf(user), 'support')) return { ok: false, reason: 'forbidden' }

      return withTransaction(payload, async (transactionID) => {
        const ticket = await findForActor(ticketNumber, user, transactionID)
        if (ticket === null) return { ok: false, reason: 'not_found' } as const

        try {
          assertTicketTransition(ticket.status, toStatus)
        } catch {
          // Returned rather than thrown: an agent clicking a stale button is an ordinary event, and
          // the order machine throws only because its callers are webhooks with no user to tell.
          return { ok: false, reason: 'invalid', detail: 'bad_status' } as const
        }

        await payload.update({
          collection: 'tickets',
          id: ticket.id,
          data: {
            status: toStatus,
            ...(toStatus === 'resolved' ? { resolvedAt: now.toISOString() } : {}),
          },
          depth: 0,
          overrideAccess: true,
          ...transactionReq(transactionID),
        })

        if (toStatus === 'resolved') await notifyCustomer(ticket, 'ticket.resolved', transactionID)

        payload.logger.info(
          { ticketNumber, from: ticket.status, to: toStatus, actor: staffIdOf(user) ?? 'unknown' },
          'Ticket status changed',
        )

        return { ok: true, ticketNumber } as const
      })
    },

    /** Assign a ticket, or clear the assignment with null. Staff only. */
    async assign(input: {
      user: unknown
      ticketNumber: string
      assignTo: number | string | null
    }): Promise<TicketUpdateResult> {
      const { user, ticketNumber, assignTo } = input

      if (!canWrite(staffRoleOf(user), 'support')) return { ok: false, reason: 'forbidden' }

      const ticket = await findForActor(ticketNumber, user)
      if (ticket === null) return { ok: false, reason: 'not_found' }

      await payload.update({
        collection: 'tickets',
        id: ticket.id,
        data: { assignedTo: assignTo === null ? null : numericId(assignTo) },
        depth: 0,
        overrideAccess: true,
      })

      return { ok: true, ticketNumber }
    },

    /** A ticket the caller is entitled to, or null. The read path for both surfaces. */
    async find(ticketNumber: string, user: unknown): Promise<Ticket | null> {
      return findForActor(ticketNumber, user)
    },

    /**
     * The signed-in customer's own tickets, newest first.
     *
     * Scoped by the session's customer id in the *query*, so another customer's row is never
     * fetched rather than being fetched and filtered (OWASP A01).
     */
    async listForCustomer(user: unknown): Promise<Ticket[]> {
      const customerId = customerIdOf(user)
      if (customerId === null) return []

      const { docs } = await payload.find({
        collection: 'tickets',
        where: { customer: { equals: numericId(customerId) } } satisfies Where,
        sort: '-createdAt',
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })

      return docs as Ticket[]
    },
  }
}

export type PayloadTickets = ReturnType<typeof createPayloadTickets>
