/**
 * The payment contract.
 *
 * `PaymentGateway` is the interface; `StubGateway` and, at J11, `RazorpayGateway` implement it.
 * Nothing in the checkout flow imports a provider — it asks the factory for a gateway and
 * depends only on what is declared here. Swapping providers is one new class.
 *
 * The interface is shaped around what actually has to be trusted, which is the part a stub does
 * not get to fake:
 *
 * - `createIntent` is a request to the provider and may well be fabricated.
 * - `verifyWebhook` is the **security boundary**. An unsigned or wrongly signed body is not a
 *   payment, whoever sent it (OWASP A08). The stub signs its callbacks for real, so this code
 *   path is exercised from day one rather than written for the first time on the day Razorpay
 *   is connected.
 * - Every event carries a provider `id`, which is the idempotency key. Providers retry, so a
 *   webhook arriving twice is normal traffic, not an attack, and must change nothing the second
 *   time.
 */

/** What the browser needs to open a payment widget. Contains no secret. */
export interface PaymentIntent {
  /** The provider's own order handle. */
  gatewayOrderId: string
  amountPaise: number
  currency: 'INR'
  /** Publishable key id. `NEXT_PUBLIC_*` by nature — never the secret half. */
  publicKey: string
  /** Our order number, echoed back on the callback so an event maps to an order. */
  reference: string
}

export const PAYMENT_EVENT_TYPES = ['payment.captured', 'payment.failed', 'refund.processed'] as const
export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number]

/**
 * A verified provider event, normalised.
 *
 * Only ever constructed by a gateway's `verifyWebhook` after the signature passed. There is no
 * public constructor for a "probably fine" event, which is what stops an unverified body from
 * being processed by a later refactor.
 */
export interface PaymentEvent {
  /** The provider's event id. The idempotency key — nothing else identifies a replay. */
  id: string
  type: PaymentEventType
  gatewayOrderId: string
  gatewayPaymentId: string
  amountPaise: number
  /** Our order number. */
  reference: string
  occurredAt: string
}

export interface CreateIntentInput {
  /** Our order number, which comes back on the event. */
  reference: string
  amountPaise: number
  email: string
  phone: string | null
}

/** The handshake a provider's browser widget hands back on success. */
export interface CheckoutConfirmation {
  gatewayOrderId: string
  gatewayPaymentId: string
  signature: string
}

export interface PaymentGateway {
  /** Recorded on the order event, so a support query can tell which gateway took the money. */
  readonly name: string

  createIntent(input: CreateIntentInput): Promise<PaymentIntent>

  /**
   * Verify and parse a webhook body.
   *
   * Takes the **raw** body string, not a parsed object: a signature covers the exact bytes sent,
   * and `JSON.parse` followed by `JSON.stringify` does not reproduce them. Returns null for
   * anything that fails verification or does not parse — the caller answers 400 and does nothing
   * else, with no hint as to which of the two it was.
   */
  verifyWebhook(rawBody: string, signature: string | null): PaymentEvent | null

  /**
   * Verify the confirmation the browser returned.
   *
   * Belt and braces alongside the webhook: it lets the success page be shown immediately without
   * trusting the client's word that payment happened. The order is still only settled by a
   * verified webhook.
   */
  verifyCheckout(confirmation: CheckoutConfirmation): boolean
}
