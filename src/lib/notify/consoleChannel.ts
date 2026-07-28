/**
 * The console channel — the stub every message goes through until J11.
 *
 * Per CLAUDE.md §2, the whole customer journey is built before a provider is connected. This
 * renders the message that Resend or the WhatsApp Cloud API will later send, prints it where a
 * developer can read it, and returns a provider id in the shape a real one does.
 *
 * What it does **not** fake, exactly as `StubGateway` and `StubShippingProvider` do not:
 *
 * - It answers `canReach` honestly. An empty address is unreachable, and an address that is not an
 *   email is unreachable *for the email channel* — so the dispatcher's skip path is exercised
 *   locally rather than discovered when a guest checkout has no phone number.
 * - Its id is unique per send, because that id is what a delivery webhook will find the row by. A
 *   constant would make every row look like the same message.
 *
 * The body is printed through `console.info` rather than Payload's logger deliberately: this is
 * developer output, several lines long, and routing it through the structured log would bury the
 * actual server log in message bodies. The *record* of the send is the `notifications` row, which
 * the dispatcher writes either way.
 */
import { randomUUID } from 'node:crypto'

import type { NotificationChannelName } from '@/types'
import type { NotificationChannel, Recipient, RenderedMessage, SendOutcome } from './types'

/** Deliberately loose. Rejecting valid-but-unusual addresses is worse than accepting one bad one. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** E.164-ish, allowing the leading `+` and 8–15 digits. */
const PHONE_SHAPE = /^\+?[0-9]{8,15}$/

export interface ConsoleChannelOptions {
  name?: NotificationChannelName
  /** Injected so a test can assert what was written without capturing global console. */
  write?: (line: string) => void
  newId?: () => string
}

export class ConsoleChannel implements NotificationChannel {
  readonly name: NotificationChannelName

  private readonly write: (line: string) => void
  private readonly newId: () => string

  constructor(options: ConsoleChannelOptions = {}) {
    this.name = options.name ?? 'email'
    this.write = options.write ?? ((line) => console.info(line))
    this.newId = options.newId ?? (() => randomUUID())
  }

  canReach(recipient: Recipient): boolean {
    const address = recipient.address.trim()
    if (address.length === 0) return false

    return this.name === 'email' ? EMAIL_SHAPE.test(address) : PHONE_SHAPE.test(address)
  }

  send(recipient: Recipient, message: RenderedMessage): Promise<SendOutcome> {
    // Refusing here as well as in `canReach` keeps the class honest on its own terms: a caller that
    // skips the check must not get a fabricated success for a message nobody could receive.
    if (!this.canReach(recipient)) {
      return Promise.resolve({ ok: false, error: `No usable ${this.name} address for this recipient` })
    }

    this.write(
      [
        '',
        `┌─ ${this.name} ────────────────────────────────`,
        `│ To:      ${recipient.address}`,
        `│ Subject: ${message.subject}`,
        '├───────────────────────────────────────────────',
        ...message.text.split('\n').map((line) => `│ ${line}`),
        '└───────────────────────────────────────────────',
        '',
      ].join('\n'),
    )

    return Promise.resolve({ ok: true, providerId: `console_${this.newId()}` })
  }
}
