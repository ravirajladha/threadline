import type { Endpoint, PayloadRequest } from 'payload'

import { createPayloadReturns } from '@/lib/returns/payloadReturns'
import { describeExchangeRefusal } from '@/lib/returns/exchange'
import { RETURN_STATUSES, type ReturnStatus } from '@/types'
import { endpoint, json, readJson, requireWrite, routeParam } from './guards'

/**
 * Moving a return, from the admin.
 *
 * Thin, like `endpoints/fulfilment.ts` and `endpoints/support.ts`: the port decides everything and
 * re-checks the role itself, because a custom endpoint bypasses collection access. `requireWrite`
 * runs first so the refusal reads identically to every other admin endpoint.
 *
 * Status lives here rather than being left to Payload's own edit form because the transitions have
 * consequences the form cannot express — approving an exchange **takes a stock reservation** that
 * can fail, and receiving a return writes ledger movements. Saving `status` in a text field would
 * skip both and leave the database saying something the warehouse does not.
 */

function toStatus(value: unknown): ReturnStatus | null {
  return typeof value === 'string' && (RETURN_STATUSES as readonly string[]).includes(value)
    ? (value as ReturnStatus)
    : null
}

/** Paise, or undefined. A refund amount is money, so anything unparseable is refused rather than coerced. */
function toPaise(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined

  return value
}

/** `POST /api/returns/:id/status` — body `{ status, refundAmount?, adminNote? }`. */
async function statusHandler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'refunds')
  if (denied) return denied

  const returnId = routeParam(req, 'id')
  if (!returnId) return json({ error: 'Missing return id.' }, 400)

  const body = await readJson(req)
  const status = toStatus(body?.status)
  if (status === null) return json({ error: `status must be one of: ${RETURN_STATUSES.join(', ')}.` }, 400)

  // A refund amount that arrived malformed is dropped rather than written as zero — a silent zero
  // is a customer refunded nothing, which nobody notices until they write in.
  if (body?.refundAmount !== undefined && toPaise(body.refundAmount) === undefined) {
    return json({ error: 'refundAmount must be a whole number of paise, zero or more.' }, 400)
  }

  const result = await createPayloadReturns({ payload: req.payload }).transition({
    user: req.user,
    returnId,
    toStatus: status,
    refundAmount: toPaise(body?.refundAmount),
    adminNote: typeof body?.adminNote === 'string' ? body.adminNote : undefined,
  })

  if (result.ok) return json({ ok: true, status: result.status })

  switch (result.reason) {
    case 'forbidden':
      return json({ error: 'You do not have permission to do that.' }, 403)
    case 'not_found':
      return json({ error: 'Return not found.' }, 404)
    case 'illegal_transition':
      return json(
        { error: `A return cannot go from ${result.from.replace(/_/g, ' ')} to ${result.to.replace(/_/g, ' ')}.` },
        409,
      )
    case 'exchange_refused':
      // The interesting one: approving an exchange failed because the replacement is no longer
      // free. Staff need the number, not a generic error, so they can offer an alternative.
      return json({ error: describeExchangeRefusal(result.refusal) }, 409)
    case 'ineligible':
      return json({ error: 'That return is not eligible.' }, 409)
  }
}

export const returnStatusEndpoint: Endpoint = endpoint('/:id/status', 'post', statusHandler)
