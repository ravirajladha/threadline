/**
 * `/api/webhooks/payments` — the only thing that may mark an order paid.
 *
 * Three properties this route exists to guarantee, all of them built for real now even though the
 * events currently come from `StubGateway` (CLAUDE.md §2):
 *
 * - **Signature first, always.** The raw body text is verified before it is parsed, because a
 *   signature covers the exact bytes sent and `JSON.parse` → `JSON.stringify` does not reproduce
 *   them. An unverified body is a 400 and nothing else happens (OWASP A08).
 * - **Idempotent by event id.** Providers retry; a payment event arriving twice is normal traffic,
 *   not an attack. The second one changes nothing, and still answers 200 — a 4xx would make the
 *   provider retry the duplicate for ever.
 * - **No detail in the response.** A rejected webhook is told "invalid", never which check it
 *   failed. Distinguishing "bad signature" from "unknown order" is free reconnaissance.
 *
 * Note the deliberate absence of a rate limit. Throttling a payment provider's callbacks means
 * dropping notice of money that has already changed hands; the signature is the gate here.
 */
import { json, safeRoute } from '@/lib/http/route'
import { createPayloadOrders } from '@/lib/orders/payloadOrders'
import { getPaymentGateway } from '@/lib/payments/factory'
import config from '@payload-config'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

/** Every rejection says the same thing, whatever the reason. */
const INVALID = { error: 'Invalid webhook.' }

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  const gateway = getPaymentGateway()

  // `.text()`, not `.json()` — see the note above on why the raw bytes matter.
  const rawBody = await request.text()

  // Header names are case-insensitive per the fetch spec, so this matches whatever casing the
  // provider chooses to send.
  const signature =
    request.headers.get('x-razorpay-signature') ?? request.headers.get('x-webhook-signature')

  const event = gateway.verifyWebhook(rawBody, signature)
  if (event === null) return json(INVALID, 400)

  const payload = await getPayload({ config })
  const orders = createPayloadOrders({ payload })

  const decision = await orders.applyPaymentEvent(event)

  // 200 either way once the signature passed. An event we chose to ignore — a duplicate, a late
  // capture on a cancelled order — was still received and understood, and telling the provider
  // otherwise buys nothing but a retry storm.
  payload.logger.info(
    { eventId: event.id, type: event.type, reference: event.reference, decision: decision.action },
    'Payment webhook processed',
  )

  return json({ received: true, action: decision.action })
})
