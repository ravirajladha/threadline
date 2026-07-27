/**
 * `/api/shipping/simulate` — the local stand-in for a courier scanning a parcel.
 *
 * The counterpart to `/api/payments/simulate`, and it exists for the same reason: fulfilment is
 * built before a Shiprocket account exists (CLAUDE.md §2), so something has to move a parcel along
 * without *bypassing* the code that will handle the real thing.
 *
 * - **It cannot exist in production.** `getShippingProvider()` throws at startup if the stub is
 *   selected with `NODE_ENV=production`, and this route additionally refuses unless the provider it
 *   got back really is a `StubShippingProvider`. A 404, not a 403 — a route that admits to existing
 *   tells an attacker what to look for. That guard *is* this route's authority: outside development
 *   it does not answer at all, so there is nothing to authenticate against.
 * - **It signs for real and verifies for real.** It does not call `applyTrackingEvent` directly. It
 *   builds the raw bytes and the signature a courier would send and hands them to the webhook
 *   route, so the local flow runs over verification rather than around it. At J11 the only
 *   difference is who makes the request.
 *
 * The next status comes from the stub's own sequence, driven off the order's current status, so a
 * caller cannot post `DELIVERED` at a parcel that was never picked up — the sequence is the thing
 * being exercised.
 */
import { getPayload } from 'payload'

import { POST as webhookRoute } from '@/app/api/webhooks/shipping/route'
import config from '@payload-config'
import { json, readJsonBody, safeRoute } from '@/lib/http/route'
import { createPayloadOrders } from '@/lib/orders/payloadOrders'
import { getShippingProvider } from '@/lib/shipping/factory'
import { STUB_TRACKING_SEQUENCE, StubShippingProvider } from '@/lib/shipping/stubProvider'

export const dynamic = 'force-dynamic'

const NOT_FOUND = { error: 'Not found.' }

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  // The factory *throws* when the stub is selected in production, or when a real provider is asked
  // for before J11 implements one. Left to propagate that is a 500 from `safeRoute` — and a 500 is
  // an admission that the route exists. Caught here so every non-development answer is the same 404.
  let provider: unknown
  try {
    provider = getShippingProvider()
  } catch {
    return json(NOT_FOUND, 404)
  }

  // Belt and braces over the factory's own production guard.
  if (!(provider instanceof StubShippingProvider)) return json(NOT_FOUND, 404)

  const body = await readJsonBody(request)
  const orderNumber = typeof body?.orderNumber === 'string' ? body.orderNumber.trim() : ''

  if (orderNumber.length === 0) return json({ error: 'An order number is required.' }, 400)

  const payload = await getPayload({ config })
  const order = await createPayloadOrders({ payload }).findByOrderNumber(orderNumber)

  if (order === null) return json({ error: 'No such order.' }, 400)
  if (typeof order.awbCode !== 'string' || order.awbCode.length === 0) {
    return json({ error: 'That order has no parcel yet. Book a shipment first.' }, 400)
  }

  // Where the parcel is *now*, expressed in the courier's vocabulary, so the stub can hand back the
  // scan that comes next. Derived from the order's status rather than taken from the request: the
  // sequence is the thing under test, and letting a caller name the next scan would skip it.
  const courierStatus = provider.nextCourierStatus(provider.currentCourierStatus(order.status))

  if (courierStatus === null) {
    return json({ error: 'This parcel has already reached the end of the tracking sequence.' }, 400)
  }

  const simulated = provider.simulateTracking({
    reference: order.orderNumber,
    awbCode: order.awbCode,
    courierStatus,
  })

  const response = await webhookRoute(
    new Request(new URL('/api/webhooks/shipping', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [simulated.header]: simulated.signature },
      body: simulated.body,
    }),
  )

  if (!response.ok) return json({ error: 'The simulated tracking event was rejected.' }, 502)

  return json({
    ok: true,
    courierStatus,
    /** Where the caller is in the sequence, so a development UI can show progress. */
    sequence: STUB_TRACKING_SEQUENCE,
  })
})
