import type { Endpoint, PayloadRequest } from 'payload'

import { createPayloadTickets } from '@/lib/support/payloadTickets'
import { describeThreadRefusal, type ThreadRefusal } from '@/lib/support/thread'
import { TICKET_STATUSES, type TicketStatus } from '@/types'
import { endpoint, json, readJson, requireWrite, routeParam } from './guards'

/**
 * Agent actions on a ticket, from the admin.
 *
 * Thin, like `endpoints/fulfilment.ts`: the port decides everything and re-checks the role itself,
 * because a custom endpoint bypasses collection access. `requireWrite` is still called first so the
 * refusal reads identically to every other admin endpoint.
 *
 * Assignment and status live here rather than being left to Payload's own edit form because both
 * have consequences the form cannot express — resolving a ticket emails the customer, and a status
 * jump has to be validated by the machine rather than accepted because it was in a dropdown.
 */

function toStatus(value: unknown): TicketStatus | null {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value)
    ? (value as TicketStatus)
    : null
}

function failureResponse(failure: { reason: 'forbidden' | 'not_found' | 'invalid'; detail?: unknown }): Response {
  switch (failure.reason) {
    case 'forbidden':
      return json({ error: 'You do not have permission to do that.' }, 403)
    case 'not_found':
      return json({ error: 'Ticket not found.' }, 404)
    case 'invalid':
      return json(
        {
          error:
            failure.detail === 'bad_status'
              ? 'That is not a move this ticket can make. Reload and try again.'
              : describeThreadRefusal(failure.detail as ThreadRefusal),
        },
        // 409 for a status the ticket cannot reach: the request is well formed and the caller is
        // allowed, but the ticket has moved since the screen rendered.
        failure.detail === 'bad_status' ? 409 : 400,
      )
  }
}

/** `POST /api/tickets/:number/reply` — body `{ body: string }`. */
async function replyHandler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'support')
  if (denied) return denied

  const ticketNumber = routeParam(req, 'number')
  if (!ticketNumber) return json({ error: 'Missing ticket number.' }, 400)

  const body = await readJson(req)
  const text = typeof body?.body === 'string' ? body.body : ''

  const result = await createPayloadTickets({ payload: req.payload }).reply({
    user: req.user,
    ticketNumber,
    body: text,
  })

  return result.ok ? json({ ok: true, message: result.message }) : failureResponse(result)
}

/** `POST /api/tickets/:number/status` — body `{ status: TicketStatus }`. */
async function statusHandler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'support')
  if (denied) return denied

  const ticketNumber = routeParam(req, 'number')
  if (!ticketNumber) return json({ error: 'Missing ticket number.' }, 400)

  const body = await readJson(req)
  const status = toStatus(body?.status)
  if (status === null) return json({ error: `status must be one of: ${TICKET_STATUSES.join(', ')}.` }, 400)

  const result = await createPayloadTickets({ payload: req.payload }).setStatus({
    user: req.user,
    ticketNumber,
    toStatus: status,
  })

  return result.ok ? json({ ok: true, status }) : failureResponse(result)
}

/**
 * `POST /api/tickets/:number/assign` — body `{ assignTo: id | null }`.
 *
 * An explicit `null` clears the assignment, which is why the field is read for its presence rather
 * than its truthiness — `assignTo: null` and a missing `assignTo` would otherwise be the same
 * request, and "unassign" would be unexpressible.
 */
async function assignHandler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'support')
  if (denied) return denied

  const ticketNumber = routeParam(req, 'number')
  if (!ticketNumber) return json({ error: 'Missing ticket number.' }, 400)

  const body = await readJson(req)
  const raw = body?.assignTo
  const assignTo = typeof raw === 'number' || typeof raw === 'string' ? raw : null

  const result = await createPayloadTickets({ payload: req.payload }).assign({
    user: req.user,
    ticketNumber,
    assignTo,
  })

  return result.ok ? json({ ok: true, assignedTo: assignTo }) : failureResponse(result)
}

export const ticketReplyEndpoint: Endpoint = endpoint('/:number/reply', 'post', replyHandler)
export const ticketStatusEndpoint: Endpoint = endpoint('/:number/status', 'post', statusHandler)
export const ticketAssignEndpoint: Endpoint = endpoint('/:number/assign', 'post', assignHandler)
