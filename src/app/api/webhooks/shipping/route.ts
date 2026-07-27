/**
 * `/api/webhooks/shipping` — the only thing that may advance an order from a courier's word.
 *
 * The same three properties as the payments webhook, and for sharper reasons: a tracking callback
 * is how an order becomes `delivered`, which closes it, stops the customer being chased and starts
 * the return window.
 *
 * - **Signature first, always.** The raw body text is verified before it is parsed, because the
 *   signature covers the exact bytes sent and `JSON.parse` → `JSON.stringify` does not reproduce
 *   them. An unverified body is a 400 and nothing else happens (OWASP A08).
 * - **Idempotent by event id.** Couriers replay scans far more freely than payment gateways do —
 *   a parcel generates many events and their delivery is best-effort — so a duplicate is ordinary
 *   traffic. It changes nothing and still answers 200; a 4xx would make the courier retry for ever.
 * - **No detail in the response.** A rejection never says which check failed.
 *
 * Deliberately no rate limit, as on the payment webhook: throttling a courier means discarding
 * notice of a parcel that has already moved. The signature is the gate.
 */
import { getPayload } from 'payload'

import config from '@payload-config'
import { json, safeRoute } from '@/lib/http/route'
import { getShippingProvider } from '@/lib/shipping/factory'
import { createPayloadShipping } from '@/lib/shipping/payloadShipping'
import { SHIPPING_SIGNATURE_HEADER } from '@/lib/shipping/stubProvider'

export const dynamic = 'force-dynamic'

const INVALID = { error: 'Invalid webhook.' }

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  const provider = getShippingProvider()

  // `.text()`, not `.json()` — see above on why the raw bytes matter.
  const rawBody = await request.text()

  // Header names are case-insensitive per the fetch spec, so this matches whatever casing the
  // courier sends. `x-webhook-signature` is accepted as the generic spelling.
  const signature =
    request.headers.get(SHIPPING_SIGNATURE_HEADER) ?? request.headers.get('x-webhook-signature')

  const event = provider.verifyWebhook(rawBody, signature)
  if (event === null) return json(INVALID, 400)

  const payload = await getPayload({ config })
  const shipping = createPayloadShipping({ payload, provider })

  const decision = await shipping.applyTrackingEvent(event)

  // Order number, AWB, the courier's own status and what we decided. No customer, no address — the
  // event's `location` is a courier hub, but it is not needed here and is left out (OWASP A09).
  payload.logger.info(
    {
      eventId: event.id,
      reference: event.reference,
      awbCode: event.awbCode,
      courierStatus: event.courierStatus,
      decision: decision.action,
      ...(decision.action === 'ignore' ? { reason: decision.reason } : { toStatus: decision.toStatus }),
    },
    'Shipping webhook processed',
  )

  return json({ received: true, action: decision.action })
})
