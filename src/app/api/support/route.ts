/**
 * `/api/support` — the customer's side of a support thread.
 *
 * One route, action-discriminated, matching `/api/cart`. Two actions only: raise a request, and
 * reply to one of your own. Everything an agent does happens in the admin through
 * `endpoints/support.ts`, because those actions need a staff session and belong on the collection.
 *
 * The security properties, which are the reason this is a route rather than direct collection
 * access:
 *
 * - **The customer comes from the session, never from the body.** `tickets.create` is open to a
 *   signed-in customer at the collection level and stamps the owner in a hook, but the *ticket
 *   number* has to be allocated server-side and the opening message has to go through the thread
 *   rules — so raising goes through the port, and the port takes the principal.
 * - **A ticket number is not a credential.** `reply` looks the ticket up *and* checks ownership,
 *   and a customer quoting somebody else's reference is told it does not exist (OWASP A01).
 * - **Rate-limited**, because both actions write and one of them writes free text (A07).
 * - **Bodies are stored and rendered as text.** Nothing here parses or emits HTML (A03).
 */
import { getPayload } from 'payload'

import config from '@payload-config'
import { readCustomerSession } from '@/lib/auth/customerSession'
import { enforceRateLimit, json, readJsonBody, safeRoute } from '@/lib/http/route'
import { createPayloadTickets } from '@/lib/support/payloadTickets'
import { describeThreadRefusal, type ThreadRefusal } from '@/lib/support/thread'
import { TICKET_CATEGORIES, type TicketCategory } from '@/types'

export const dynamic = 'force-dynamic'

const SIGNED_OUT = { error: 'Please sign in to use support.' }

/** Narrow a body field to a category, defaulting rather than refusing — it is a routing hint. */
function toCategory(value: unknown): TicketCategory {
  return typeof value === 'string' && (TICKET_CATEGORIES as readonly string[]).includes(value)
    ? (value as TicketCategory)
    : 'other'
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Turn a port failure into a response. Kept in one place so the two actions cannot answer differently. */
function failureResponse(failure: { reason: 'forbidden' | 'not_found' | 'invalid'; detail?: unknown }): Response {
  switch (failure.reason) {
    case 'forbidden':
      return json(SIGNED_OUT, 401)
    case 'not_found':
      // Deliberately the same answer for "no such ticket" and "not yours".
      return json({ error: 'We could not find that request.' }, 404)
    case 'invalid':
      return json(
        {
          error:
            failure.detail === 'no_subject'
              ? 'Please give your request a subject.'
              : describeThreadRefusal(failure.detail as ThreadRefusal),
        },
        400,
      )
  }
}

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  const body = await readJsonBody(request)
  if (body === null) return json({ error: 'Expected a JSON body.' }, 400)

  const action = typeof body.action === 'string' ? body.action : ''
  if (action !== 'raise' && action !== 'reply') {
    return json({ error: 'action must be one of: raise, reply.' }, 400)
  }

  // Limited before the session is read, so an unauthenticated flood costs a counter increment
  // rather than a database round trip.
  const limited = enforceRateLimit(request, action === 'raise' ? 'supportRaise' : 'supportReply')
  if (limited) return limited

  const payload = await getPayload({ config })
  const session = await readCustomerSession(request.headers, payload)

  if (session === null) return json(SIGNED_OUT, 401)

  const tickets = createPayloadTickets({ payload })

  if (action === 'raise') {
    const result = await tickets.raise({
      user: session.user,
      subject: toText(body.subject),
      body: toText(body.body),
      category: toCategory(body.category),
      // An order the customer does not own is dropped by the port, not refused here — refusing
      // would tell a prober which order ids exist.
      orderId: typeof body.orderId === 'number' || typeof body.orderId === 'string' ? body.orderId : null,
    })

    return result.ok ? json({ ok: true, ticketNumber: result.ticketNumber }, 201) : failureResponse(result)
  }

  const result = await tickets.reply({
    user: session.user,
    ticketNumber: toText(body.ticketNumber),
    body: toText(body.body),
  })

  return result.ok ? json({ ok: true, ticketNumber: result.ticketNumber }) : failureResponse(result)
})
