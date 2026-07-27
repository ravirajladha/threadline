/**
 * `/api/payments/simulate` — the local stand-in for a customer completing payment.
 *
 * This is the one route that exists purely because the outside world is stubbed. It builds the
 * webhook a provider *would* send and feeds it through the real webhook handler, so the local
 * happy path runs over genuine signature verification, genuine idempotency and the genuine order
 * status machine rather than around them.
 *
 * Two things keep it honest:
 *
 * - **It cannot exist in production.** `getPaymentGateway()` throws at startup if the stub is
 *   selected with `NODE_ENV=production`, and this route additionally refuses unless the gateway
 *   it got back really is a `StubGateway`. A 404, not a 403 — a route that admits to existing
 *   tells an attacker what to look for (CLAUDE.md §2, cron-route rule).
 * - **It signs for real and verifies for real.** It does not call `applyPaymentEvent` directly.
 *   It hands raw bytes and a signature to the webhook route, exactly as Razorpay will, so the
 *   only difference at J11 is who makes the request.
 *
 * The order it may settle is the one in the caller's own `tl_order` cookie. Without that, a POST
 * with an order number in it would let anyone mark a stranger's order paid.
 */
import { POST as webhookRoute } from '@/app/api/webhooks/payments/route'
import { json, readJsonBody, safeRoute } from '@/lib/http/route'
import { readRecentOrder } from '@/lib/orders/recentOrder'
import { createPayloadOrders } from '@/lib/orders/payloadOrders'
import { getPaymentGateway } from '@/lib/payments/factory'
import { StubGateway } from '@/lib/payments/stubGateway'
import config from '@payload-config'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

const NOT_FOUND = { error: 'Not found.' }

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  const gateway = getPaymentGateway()

  // Belt and braces over the factory's own production guard.
  if (!(gateway instanceof StubGateway)) return json(NOT_FOUND, 404)

  const orderNumber = await readRecentOrder()
  if (orderNumber === null) return json({ error: 'There is no order to pay for.' }, 400)

  const body = await readJsonBody(request)
  // Anything other than an explicit failure request is a payment. The failure path is offered
  // because it is the one our own code has to handle correctly — the reservation is released and
  // the order moves to a failed state — and it is untestable by hand otherwise.
  const outcome = body?.outcome === 'fail' ? 'payment.failed' : 'payment.captured'

  const payload = await getPayload({ config })
  const orders = createPayloadOrders({ payload })

  const order = await orders.findByOrderNumber(orderNumber)
  if (order === null) return json({ error: 'There is no order to pay for.' }, 400)

  // The amount comes from the order row, never from the request. A capture for the wrong amount
  // is refused by `decidePaymentApply`, and the point of the stub is to reproduce a correct
  // provider, not to hand the browser a way to choose what it paid.
  const simulated = gateway.simulateWebhook({
    reference: order.orderNumber,
    gatewayOrderId: order.razorpayOrderId ?? `stub_order_${order.orderNumber}`,
    amountPaise: order.grandTotal,
    type: outcome,
  })

  const response = await webhookRoute(
    new Request(new URL('/api/webhooks/payments', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [simulated.header]: simulated.signature },
      body: simulated.body,
    }),
  )

  if (!response.ok) return json({ error: 'The simulated payment was rejected.' }, 502)

  return json({
    ok: true,
    outcome,
    redirectUrl: outcome === 'payment.captured' ? '/checkout/success' : '/checkout/failed',
  })
})
