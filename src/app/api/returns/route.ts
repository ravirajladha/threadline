/**
 * `/api/returns` — the customer's side of sending something back.
 *
 * One action today: raise a return or an exchange. Everything staff do happens through Payload
 * endpoints on the collection, because those need a staff session and belong beside the data.
 *
 * The security properties:
 *
 * - **The customer comes from the session**, and the order is matched against it in the same query
 *   (`payloadReturns.ownedOrder`). An order number is printed on emails and is trivially walked, so
 *   it authorises nothing here (OWASP A01).
 * - **Quantities are input, not data.** `checkReturnRequest` re-derives what is actually returnable
 *   from the order and its existing returns, and refuses anything beyond it — a form can be edited,
 *   and "return 50 of the one I bought" is a refund for 49 garments nobody owns (A04).
 * - **Rate-limited**, and limited *before* the session is read, so an unauthenticated flood costs a
 *   counter increment rather than three database queries.
 * - The collection's own `create` is staff-only since the J8 pass, so this is the only way in.
 */
import { getPayload } from 'payload'

import config from '@payload-config'
import { readCustomerSession } from '@/lib/auth/customerSession'
import { enforceRateLimit, json, readJsonBody, safeRoute } from '@/lib/http/route'
import { describeReturnRefusal } from '@/lib/returns/eligibility'
import { describeExchangeRefusal } from '@/lib/returns/exchange'
import { createPayloadReturns, type RequestedReturnLine } from '@/lib/returns/payloadReturns'
import { RETURN_TYPES, type ReturnType as ReturnKind } from '@/types'

export const dynamic = 'force-dynamic'

const SIGNED_OUT = { error: 'Please sign in to send something back.' }

/** The reasons the collection accepts. Mirrors the `items.reason` options on `returns`. */
const RETURN_REASONS = [
  'too_small',
  'too_large',
  'not_as_described',
  'damaged',
  'wrong_item',
  'changed_mind',
] as const

function toReturnKind(value: unknown): ReturnKind {
  return typeof value === 'string' && (RETURN_TYPES as readonly string[]).includes(value)
    ? (value as ReturnKind)
    : 'return'
}

/**
 * Narrow the submitted lines.
 *
 * Shape only — *how many* may be returned is not this function's business, and duplicating that
 * rule here is how the two versions drift. `checkReturnRequest` owns it.
 */
function toLines(value: unknown): RequestedReturnLine[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []

    const row = entry as Record<string, unknown>
    const orderItemId = typeof row.orderItemId === 'number' ? row.orderItemId : Number(row.orderItemId)
    const qty = typeof row.qty === 'number' ? row.qty : Number(row.qty)

    if (!Number.isInteger(orderItemId) || !Number.isFinite(qty)) return []

    const reason =
      typeof row.reason === 'string' && (RETURN_REASONS as readonly string[]).includes(row.reason)
        ? row.reason
        : 'changed_mind'

    return [{ orderItemId, qty, reason }]
  })
}

/** A message for each way the port can refuse. One place, so two actions cannot answer differently. */
function failureResponse(failure: {
  reason: 'forbidden' | 'not_found' | 'ineligible' | 'exchange_refused' | 'illegal_transition'
  refusal?: unknown
}): Response {
  switch (failure.reason) {
    case 'forbidden':
      return json(SIGNED_OUT, 401)
    case 'not_found':
      // Deliberately the same answer for "no such order" and "not yours".
      return json({ error: 'We could not find that order.' }, 404)
    case 'exchange_refused':
      return json(
        { error: describeExchangeRefusal(failure.refusal as Parameters<typeof describeExchangeRefusal>[0]) },
        409,
      )
    case 'ineligible': {
      const refusal = failure.refusal as { reason: string; refusal?: unknown; maxQty?: number }

      // A line-level refusal already has a customer-facing sentence; the request-shape ones do not,
      // because they describe a form that should not have been submittable.
      if (refusal.reason === 'line_refused' && refusal.refusal !== undefined) {
        return json(
          { error: describeReturnRefusal(refusal.refusal as Parameters<typeof describeReturnRefusal>[0]) },
          409,
        )
      }

      if (refusal.reason === 'qty_too_high') {
        return json({ error: `You can send back at most ${refusal.maxQty ?? 0} of that.` }, 409)
      }

      return json({ error: 'Please choose what you would like to send back.' }, 400)
    }
    case 'illegal_transition':
      return json({ error: 'That return has already moved on. Reload and try again.' }, 409)
  }
}

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  const body = await readJsonBody(request)
  if (body === null) return json({ error: 'Expected a JSON body.' }, 400)

  if (body.action !== 'raise') return json({ error: 'action must be: raise.' }, 400)

  const limited = enforceRateLimit(request, 'returnRaise')
  if (limited) return limited

  const payload = await getPayload({ config })
  const session = await readCustomerSession(request.headers, payload)

  if (session === null) return json(SIGNED_OUT, 401)

  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim() : ''
  if (orderNumber.length === 0) return json({ error: 'Which order is this about?' }, 400)

  const result = await createPayloadReturns({ payload }).raise({
    user: session.user,
    orderNumber,
    type: toReturnKind(body.type),
    lines: toLines(body.lines),
    exchangeVariantId:
      typeof body.exchangeVariantId === 'number' ? body.exchangeVariantId : null,
    // Trimmed and bounded: this lands in `customerNote`, which staff read, and an unbounded text
    // field reachable from the storefront is a way to fill the database.
    customerNote:
      typeof body.customerNote === 'string' ? body.customerNote.trim().slice(0, 2_000) : undefined,
  })

  return result.ok
    ? json({ ok: true, id: result.id, status: result.status }, 201)
    : failureResponse(result)
})
