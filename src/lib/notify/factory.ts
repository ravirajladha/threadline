/**
 * Choosing the channels.
 *
 * The same rule as `payments/factory.ts` and `shipping/factory.ts`, for the same reason: **a stub
 * must be impossible to reach in production.** A shop that prints its shipping confirmations to a
 * server log instead of sending them is worse than one that refuses to boot, because the failure is
 * invisible — every order looks fine and no customer hears anything.
 *
 * Selection is by environment only. There is deliberately no branch inside the dispatcher asking
 * "are we stubbing?", because that branch is how a stub eventually runs somewhere it should not.
 */
import type { Payload } from 'payload'

import { ConsoleChannel } from './consoleChannel'
import { createDispatcher, type Dispatcher } from './dispatcher'
import type { NotificationChannel } from './types'

export const NOTIFICATION_PROVIDERS = ['console', 'resend'] as const
export type NotificationProviderName = (typeof NOTIFICATION_PROVIDERS)[number]

export class NotificationConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotificationConfigurationError'
  }
}

export interface NotificationEnvironment {
  NODE_ENV?: string | undefined
  NOTIFICATION_PROVIDER?: string | undefined
  RESEND_API_KEY?: string | undefined
}

/**
 * Build the channel list for this environment.
 *
 * The environment is a parameter rather than read from `process.env` inside, so the production
 * guard can be tested — the one behaviour here that must not be taken on trust.
 */
export function createNotificationChannels(
  env: NotificationEnvironment = process.env,
): NotificationChannel[] {
  const isProduction = env.NODE_ENV === 'production'
  const provider = (env.NOTIFICATION_PROVIDER ?? 'console').trim().toLowerCase()

  if (provider === 'resend') {
    // J11 replaces this with `new ResendChannel(...)`. Until then, asking for Resend is a
    // configuration error rather than a silent downgrade to the console.
    throw new NotificationConfigurationError(
      'NOTIFICATION_PROVIDER=resend is not implemented until J11. Unset it to use the console channel.',
    )
  }

  if (provider !== 'console') {
    throw new NotificationConfigurationError(
      `Unknown NOTIFICATION_PROVIDER "${provider}". Expected one of: ${NOTIFICATION_PROVIDERS.join(', ')}.`,
    )
  }

  if (isProduction) {
    throw new NotificationConfigurationError(
      'The console notification channel cannot run in production. Set NOTIFICATION_PROVIDER to a real provider before deploying.',
    )
  }

  // Email only for now. WhatsApp joins this list at J11, ahead of or behind email depending on what
  // the customer opted into — which is why `dispatch` takes an ordered list rather than one channel.
  return [new ConsoleChannel({ name: 'email' })]
}

/**
 * The dispatcher for a Payload instance.
 *
 * Not memoised, unlike the payment and shipping providers: those hold a signing secret that must be
 * identical across a request pair, and this holds none. It does hold a `payload`, and caching one
 * of those across instances is how a test ends up writing to another test's database.
 */
export function getDispatcher(payload: Payload): Dispatcher {
  return createDispatcher({ payload, channels: createNotificationChannels() })
}
