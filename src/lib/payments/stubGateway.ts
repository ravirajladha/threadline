/**
 * The stub payment gateway.
 *
 * Per CLAUDE.md §2 "Build order — stub the outside world first": the whole customer journey is
 * built and walkable before a provider account exists. This class always succeeds, fabricates
 * its ids, and costs nothing.
 *
 * What it does **not** fake is the part that has to be right:
 *
 * - It signs its webhook bodies with a real HMAC, so `verifyWebhook` is genuinely verifying and
 *   the endpoint's rejection path is exercised on every test run.
 * - Its events carry ids, so the idempotency logic has something real to deduplicate.
 * - Its payloads have the same shape a real one will, so J11's swap is a new class and a contract
 *   test rather than a rewrite of every call site.
 *
 * `simulateWebhook` is what makes local development possible: it hands back a signed body and
 * header pair to POST at the webhook route, which is exactly what the provider will later send.
 * It is deliberately part of this class and not the interface — a real gateway has no such method,
 * so nothing in the flow can come to depend on one.
 */
import { randomUUID } from 'node:crypto'

import { hmacSha256Hex, verifyHmacSignature } from './signature'
import type {
  CheckoutConfirmation,
  CreateIntentInput,
  PaymentEvent,
  PaymentEventType,
  PaymentGateway,
  PaymentIntent,
} from './types'

/** The header a real provider uses. Kept identical so the route does not change at J11. */
export const PAYMENT_SIGNATURE_HEADER = 'x-razorpay-signature'

export class StubGateway implements PaymentGateway {
  readonly name = 'stub'

  private readonly secret: string
  private readonly publicKey: string
  private readonly now: () => Date
  private readonly newId: () => string

  /**
   * Collaborators arrive through the constructor, including the clock and the id source, so a
   * test can pin both and assert on an exact payload rather than a shape.
   */
  constructor(options: { secret: string; publicKey?: string; now?: () => Date; newId?: () => string } ) {
    if (options.secret.length === 0) {
      throw new Error('StubGateway needs a signing secret, so that signature verification is real')
    }

    this.secret = options.secret
    this.publicKey = options.publicKey ?? 'stub_key'
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => randomUUID())
  }

  createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
      // Every real gateway has a floor. Rejecting here means the checkout flow handles the
      // case now, rather than discovering it against a live account.
      return Promise.reject(new Error(`A payment must be at least 100 paise, received ${input.amountPaise}`))
    }

    return Promise.resolve({
      gatewayOrderId: `stub_order_${this.newId()}`,
      amountPaise: input.amountPaise,
      currency: 'INR',
      publicKey: this.publicKey,
      reference: input.reference,
    })
  }

  verifyWebhook(rawBody: string, signature: string | null): PaymentEvent | null {
    if (!verifyHmacSignature({ secret: this.secret, payload: rawBody, signature })) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return null
    }

    return toPaymentEvent(parsed)
  }

  verifyCheckout(confirmation: CheckoutConfirmation): boolean {
    // Razorpay's own scheme: the signature covers "<order_id>|<payment_id>".
    return verifyHmacSignature({
      secret: this.secret,
      payload: `${confirmation.gatewayOrderId}|${confirmation.gatewayPaymentId}`,
      signature: confirmation.signature,
    })
  }

  // --- Development affordances, not part of the interface --------------------

  /** The signature a browser widget would return, for driving a local success flow. */
  signCheckout(gatewayOrderId: string, gatewayPaymentId: string): string {
    return hmacSha256Hex(this.secret, `${gatewayOrderId}|${gatewayPaymentId}`)
  }

  /**
   * Build a signed webhook, exactly as the provider would send it.
   *
   * Returns the raw body *and* its signature, because the raw bytes are what the signature
   * covers — handing back a parsed object here would make the local flow pass a check that
   * production then fails.
   */
  simulateWebhook(input: {
    reference: string
    gatewayOrderId: string
    amountPaise: number
    type?: PaymentEventType
    eventId?: string
    gatewayPaymentId?: string
  }): { body: string; signature: string; header: string; event: PaymentEvent } {
    const event: PaymentEvent = {
      id: input.eventId ?? `stub_evt_${this.newId()}`,
      type: input.type ?? 'payment.captured',
      gatewayOrderId: input.gatewayOrderId,
      gatewayPaymentId: input.gatewayPaymentId ?? `stub_pay_${this.newId()}`,
      amountPaise: input.amountPaise,
      reference: input.reference,
      occurredAt: this.now().toISOString(),
    }

    const body = JSON.stringify(event)

    return { body, signature: hmacSha256Hex(this.secret, body), header: PAYMENT_SIGNATURE_HEADER, event }
  }
}

/**
 * Narrow an unknown parsed body into an event, or null.
 *
 * Every field is checked even though the signature already passed. A valid signature proves the
 * body came from the provider; it says nothing about the provider having sent the fields this
 * version of the code expects, and a missing `reference` should be a 400 rather than an
 * `undefined` reaching a database query (OWASP A08).
 */
export function toPaymentEvent(value: unknown): PaymentEvent | null {
  if (typeof value !== 'object' || value === null) return null

  const body = value as Record<string, unknown>

  const id = typeof body.id === 'string' ? body.id : null
  const type = typeof body.type === 'string' ? body.type : null
  const gatewayOrderId = typeof body.gatewayOrderId === 'string' ? body.gatewayOrderId : null
  const gatewayPaymentId = typeof body.gatewayPaymentId === 'string' ? body.gatewayPaymentId : null
  const reference = typeof body.reference === 'string' ? body.reference : null
  const amountPaise = typeof body.amountPaise === 'number' ? body.amountPaise : null

  if (id === null || gatewayOrderId === null || gatewayPaymentId === null || reference === null) return null
  if (amountPaise === null || !Number.isInteger(amountPaise) || amountPaise < 0) return null
  if (type !== 'payment.captured' && type !== 'payment.failed' && type !== 'refund.processed') return null

  return {
    id,
    type,
    gatewayOrderId,
    gatewayPaymentId,
    amountPaise,
    reference,
    occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : new Date(0).toISOString(),
  }
}
