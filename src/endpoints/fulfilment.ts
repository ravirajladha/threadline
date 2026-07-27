import type { Endpoint, PayloadRequest } from 'payload'

import { createPayloadFulfilment } from '@/lib/orders/payloadFulfilment'
import { FULFILMENT_ACTIONS, type FulfilmentAction } from '@/lib/orders/fulfilment'
import { getShippingProvider } from '@/lib/shipping/factory'
import { createPayloadShipping } from '@/lib/shipping/payloadShipping'
import { endpoint, json, readJson, requireWrite, routeParam } from './guards'

/**
 * Fulfilment actions, from the admin order view.
 *
 * Thin by design. Every decision — may this caller act, is this action available on this order,
 * what does it move to — belongs to `payloadFulfilment`, which re-checks the role itself precisely
 * because a custom endpoint bypasses collection access. What is left here is HTTP: read the body,
 * narrow it, and map an outcome onto a status code.
 *
 * `requireWrite` is still called first even though the port repeats the check. Not redundancy for
 * its own sake: it keeps the refusal message and shape identical to every other admin endpoint, and
 * a guard that is only ever *inside* the thing being guarded is one refactor away from being lost.
 */

/** Narrow a body field to one of the three actions. Anything else is a 400, not a default. */
function toAction(value: unknown): FulfilmentAction | null {
  return typeof value === 'string' && (FULFILMENT_ACTIONS as readonly string[]).includes(value)
    ? (value as FulfilmentAction)
    : null
}

function fulfilmentFor(req: PayloadRequest) {
  return createPayloadFulfilment({
    payload: req.payload,
    // A thunk: asking the factory for a courier throws when none is configured, and packing an
    // order is not a thing that should need one.
    shipping: () => createPayloadShipping({ payload: req.payload, provider: getShippingProvider() }),
  })
}

/**
 * `POST /api/orders/:id/fulfil`
 *
 * Body: `{ action: 'pack' | 'ship' | 'deliver', note?: string }`
 */
async function fulfilHandler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'orders')
  if (denied) return denied

  const orderId = routeParam(req, 'id')
  if (!orderId) return json({ error: 'Missing order id.' }, 400)

  const body = await readJson(req)
  const action = toAction(body?.action)
  if (action === null) {
    return json({ error: `action must be one of: ${FULFILMENT_ACTIONS.join(', ')}.` }, 400)
  }

  const note = typeof body?.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : undefined

  const outcome = await fulfilmentFor(req).perform({ orderId, action, user: req.user, note })

  if (outcome.ok) return json({ ok: true, action: outcome.action, status: outcome.toStatus })

  switch (outcome.reason) {
    case 'forbidden':
      return json({ error: 'You do not have permission to do that.' }, 403)
    case 'not_found':
      return json({ error: 'Order not found.' }, 404)
    case 'refused':
      // 409, not 400: the request was well formed and the caller is allowed. The *order* is in a
      // state that does not permit it, which is a conflict, and the message says which.
      return json({ error: outcome.message, reason: outcome.refusal.reason }, 409)
  }
}

/**
 * `POST /api/orders/:id/book-shipment`
 *
 * No body. The parcel is described entirely from the order, because a caller choosing the weight or
 * the amount to collect on delivery is a caller choosing what the courier charges us (OWASP A04).
 */
async function bookHandler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'orders')
  if (denied) return denied

  const orderId = routeParam(req, 'id')
  if (!orderId) return json({ error: 'Missing order id.' }, 400)

  const outcome = await fulfilmentFor(req).bookShipment({ orderId, user: req.user })

  if (outcome.ok) {
    return json({
      ok: true,
      awbCode: outcome.awbCode,
      courier: outcome.courier,
      alreadyBooked: outcome.alreadyBooked,
    })
  }

  switch (outcome.reason) {
    case 'forbidden':
      return json({ error: 'You do not have permission to do that.' }, 403)
    case 'not_found':
      return json({ error: 'Order not found.' }, 404)
    case 'not_bookable':
      return json({ error: 'This order is not at a stage where a parcel can be booked.' }, 409)
    case 'no_pincode':
      return json({ error: 'This order has no delivery pincode, so no courier will take it.' }, 409)
    case 'no_items':
      return json({ error: 'This order has no items to put in a parcel.' }, 409)
  }
}

export const fulfilOrderEndpoint: Endpoint = endpoint('/:id/fulfil', 'post', fulfilHandler)
export const bookShipmentEndpoint: Endpoint = endpoint('/:id/book-shipment', 'post', bookHandler)
