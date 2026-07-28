/**
 * The notification contract.
 *
 * CLAUDE.md's engineering standards ask for notifications to be *a system* — "one dispatcher, many
 * channels, not scattered `send()` calls". This file is the seam that makes that true: everything
 * that wants to tell a customer something depends only on what is declared here, and a channel is
 * one class implementing one interface.
 *
 * As with `PaymentGateway` and `ShippingProvider`, the interface is drawn around **what a provider
 * genuinely owns**:
 *
 * - **Rendering is ours.** A channel receives a finished subject and body. Handing a provider our
 *   template variables would put the wording — and therefore what personal data leaves the building
 *   — inside a vendor's system.
 * - **Delivery is theirs**, and it can fail. `send` returns an outcome rather than throwing,
 *   because a failed message must never become an exception travelling up through a checkout.
 * - **The id it returns is the idempotency handle for the *delivery* side**: it is what a provider's
 *   delivery webhook will find the `notifications` row by, which is why the column is indexed.
 */
import type { NotificationChannelName, NotificationEvent } from '@/types'

/**
 * Who a message is going to.
 *
 * Deliberately narrow. A channel needs an address and, for the greeting, a first name — it does not
 * need a customer id, an order history or an address, and cannot leak what it is never given
 * (OWASP A09).
 */
export interface Recipient {
  /** Email address or phone number, depending on the channel. */
  address: string
  /** First name only, for the greeting. Optional — a guest checkout may not have one. */
  name?: string | null
}

/** A message after rendering: what a channel actually transmits. */
export interface RenderedMessage {
  /** Subject line. Ignored by channels that have no concept of one, such as WhatsApp. */
  subject: string
  /** Plain text. The only body J6 produces; J11's email channel adds a React Email counterpart. */
  text: string
}

export type SendOutcome =
  | { ok: true; providerId: string }
  /** A message for the `notifications.error` column. Never a stack trace. */
  | { ok: false; error: string }

export interface NotificationChannel {
  /** Matches `notifications.channel`, so a row says which pipe carried it. */
  readonly name: NotificationChannelName

  /**
   * Whether this channel can reach the recipient at all.
   *
   * Asked *before* sending so a missing phone number is a skip rather than a failed row — those are
   * different facts, and a log full of failures nobody can act on hides the ones somebody can.
   */
  canReach(recipient: Recipient): boolean

  send(recipient: Recipient, message: RenderedMessage): Promise<SendOutcome>
}

/**
 * What one `dispatch` call did.
 *
 * Returned rather than thrown, in every case. The caller is usually a checkout or a status
 * transition, and CLAUDE.md is explicit that a notification failure must not block the order flow —
 * so there is no failure mode here that a caller has to catch.
 */
export type DispatchResult =
  | { status: 'sent'; event: NotificationEvent; channel: NotificationChannelName; providerId: string }
  /** Already sent for this subject. The reason a cron firing hourly does not mail hourly. */
  | { status: 'duplicate'; event: NotificationEvent }
  /** No channel could reach this recipient — a guest with no email, an account with no phone. */
  | { status: 'unreachable'; event: NotificationEvent }
  /** Delivery was attempted and failed. A `failed` row exists and the error is logged. */
  | { status: 'failed'; event: NotificationEvent; channel: NotificationChannelName; error: string }
