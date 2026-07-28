/**
 * `/api/checkout` — turn the session's cart into an order.
 *
 * The single most security-sensitive route on the storefront, so the order of operations is the
 * order of trust:
 *
 * 1. The cart is read **from the session cookie**. The body cannot name a cart (OWASP A01).
 * 2. The address and email are validated with the same functions the form used, because a form is
 *    a convenience and never a boundary.
 * 3. The cart is priced **again**, server-side, with the delivery state and payment method now
 *    known — so GST is split against the real destination and carriage reflects the real method.
 *    Nothing about money is read from the request (OWASP A04).
 * 4. `assertDraftReconciles` refuses to write an order whose parts do not sum to its total.
 * 5. Stock is held inside a transaction *before* the order row exists, so a shortage means there
 *    is no order to undo.
 *
 * What this route deliberately does **not** do is mark anything paid. A prepaid order is created
 * `pending` and is settled only by a signature-verified webhook. The browser is never believed
 * about payment, which is the property that has to be true for the stub and the real gateway
 * alike.
 */
import { getCart, readCartSession } from '@/lib/cart/server'
import { enforceRateLimit, json, readJsonBody, safeRoute } from '@/lib/http/route'
import { getDispatcher } from '@/lib/notify/factory'
import { firstNameOf } from '@/lib/notify/recipient'
import { normaliseEmail, validateAddress } from '@/lib/orders/address'
import { assertDraftReconciles, buildOrderDraft, EmptyOrderError } from '@/lib/orders/draft'
import { createPayloadOrders } from '@/lib/orders/payloadOrders'
import { rememberOrder } from '@/lib/orders/recentOrder'
import { getPaymentGateway } from '@/lib/payments/factory'
import { loadPricingSettings } from '@/lib/settings/storeSettings'
import type { PaymentMethod } from '@/types'
import config from '@payload-config'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

const BAD_REQUEST = 'We could not understand that request.'

/** The most points a request may ask to spend, before the pricing layer caps it properly. */
const MAX_POINTS_REQUEST = 1_000_000

function toPaymentMethod(value: unknown): PaymentMethod | null {
  return value === 'cod' || value === 'razorpay' ? value : null
}

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  const limited = enforceRateLimit(request, 'checkout')
  if (limited !== null) return limited

  const body = await readJsonBody(request)
  if (body === null) return json({ error: BAD_REQUEST }, 400)

  const sessionId = await readCartSession()
  if (sessionId === null) {
    return json({ error: 'Your bag has expired. Please add your items again.' }, 400)
  }

  const paymentMethod = toPaymentMethod(body.paymentMethod)
  if (paymentMethod === null) return json({ error: BAD_REQUEST }, 400)

  const shippingCheck = validateAddress(body.shippingAddress)
  // A billing address is optional in the UI — "same as delivery" is the default — so an absent
  // one means the delivery address rather than a validation failure.
  const billingCheck =
    body.billingAddress === undefined || body.billingAddress === null
      ? shippingCheck
      : validateAddress(body.billingAddress)

  const email = normaliseEmail(body.email)

  if (!shippingCheck.ok || !billingCheck.ok || email === null) {
    return json(
      {
        error: 'Please check the delivery details and try again.',
        fields: { shipping: shippingCheck.errors, billing: billingCheck.errors },
      },
      400,
    )
  }

  const requestedPoints =
    typeof body.loyaltyPointsRequested === 'number' && Number.isFinite(body.loyaltyPointsRequested)
      ? Math.min(MAX_POINTS_REQUEST, Math.max(0, Math.floor(body.loyaltyPointsRequested)))
      : 0

  const cart = await getCart()

  // The authoritative price. The figures the checkout page was showing were computed without a
  // delivery state, so this is the first time GST is split against the real destination — and it
  // is this result, not the page's, that becomes the order.
  const priced = await cart.getPricedCart(sessionId, {
    shippingState: shippingCheck.address.state,
    paymentMethod,
    loyaltyPointsRequested: requestedPoints,
  })

  if (priced.view.isEmpty) {
    return json({ error: 'Your bag is empty.' }, 400)
  }
  if (!priced.view.canCheckout) {
    return json(
      { error: 'Some items in your bag are unavailable. Please review it before paying.' },
      409,
    )
  }

  const payload = await getPayload({ config })
  const settings = await loadPricingSettings(payload)

  // COD is a setting, and a request naming it while it is switched off is refused rather than
  // silently converted — the customer must not be shown one payment method and given another.
  if (paymentMethod === 'cod' && !settings.shipping.codEnabled) {
    return json({ error: 'Cash on delivery is not available at the moment.' }, 400)
  }

  const orders = createPayloadOrders({ payload })
  const placedAt = new Date()
  const orderNumber = await orders.allocateOrderNumber(placedAt)

  let draft
  try {
    draft = buildOrderDraft({
      orderNumber,
      customerId: priced.customerId,
      email,
      phone: shippingCheck.address.phone,
      shippingAddress: shippingCheck.address,
      billingAddress: billingCheck.address,
      lines: priced.view.lines,
      pricing: priced.pricing,
      paymentMethod,
      placedAt,
    })

    // The invariant, checked before anything is written: subtotal + shipping + tax − discount
    // − loyalty must equal the grand total to the paise, or no order is created at all.
    assertDraftReconciles(draft)
  } catch (error) {
    if (error instanceof EmptyOrderError) {
      return json({ error: 'There is nothing in your bag that can be ordered.' }, 400)
    }

    // A reconciliation failure is a bug in our maths, not something the customer did. It is
    // re-thrown into the route's error boundary so it is logged loudly and answered with a 500,
    // because charging someone against totals that do not add up is worse than failing.
    throw error
  }

  const placement = await orders.placeOrder({ draft, cartId: priced.cartId })

  if (!placement.ok) {
    return json(
      {
        error: 'Stock ran out while you were checking out.',
        shortages: placement.shortages,
      },
      409,
    )
  }

  // From here the order exists. Remember it before returning, so the confirmation page can be
  // read without trusting an order number in the URL.
  await rememberOrder(placement.orderNumber)

  // The one message no status change can send: an order is *created* at `pending`, and
  // `statusNotification.ts` deliberately says nothing about entering a status the order was born
  // in. The result is ignored on purpose — `dispatch` never throws, and a customer's order must not
  // fail because their mail provider did (CLAUDE.md: failures never block the order flow).
  await getDispatcher(payload).dispatch({
    event: 'order.placed',
    recipient: { address: email, name: firstNameOf(shippingCheck.address.name) },
    subject: `order:${placement.orderNumber}:placed`,
    variables: {
      orderNumber: placement.orderNumber,
      itemCount: draft.items.length,
      totalPaise: draft.order.grandTotal,
    },
  })

  if (paymentMethod === 'cod') {
    // A COD order is already confirmed by `buildOrderDraft` — there is nothing to pay online.
    return json({ ok: true, orderNumber: placement.orderNumber, redirectUrl: '/checkout/success' })
  }

  const gateway = getPaymentGateway()
  const intent = await gateway.createIntent({
    reference: placement.orderNumber,
    amountPaise: draft.order.grandTotal,
    email,
    phone: shippingCheck.address.phone,
  })

  // Stored on the order rather than carried in the URL. The pay screen needs to know which
  // gateway order it is settling, and a query parameter would be input the page has no way to
  // verify — whereas the order row is ours. It is also what a support query will be searched by
  // when a real provider is connected.
  await payload.update({
    collection: 'orders',
    id: placement.orderId,
    data: { razorpayOrderId: intent.gatewayOrderId },
    depth: 0,
    overrideAccess: true,
  })

  return json({
    ok: true,
    orderNumber: placement.orderNumber,
    // A route of ours, never a provider URL built from anything the caller sent (OWASP A10).
    // Under the stub this is the local pay screen; at J11 it becomes the page that opens
    // Razorpay's widget with this intent.
    redirectUrl: '/checkout/pay',
  })
})
