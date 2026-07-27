/**
 * Choosing a payment gateway.
 *
 * The rule from CLAUDE.md §2: **a stub must be impossible to reach in production.** The factory
 * throws at startup when `NODE_ENV=production` and no real gateway is configured, rather than
 * quietly falling back — a store that silently accepts fake payments is worse than a store that
 * refuses to boot, because nobody finds out until the stock has shipped.
 *
 * Selection is by environment only. There is deliberately no branch inside business logic asking
 * "are we stubbing?", because that branch is how a stub eventually runs somewhere it should not.
 */
import { StubGateway } from './stubGateway'
import type { PaymentGateway } from './types'

export const PAYMENT_PROVIDERS = ['stub', 'razorpay'] as const
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number]

/** A development signing secret, so the stub's signature checks are real without any setup. */
const DEV_STUB_SECRET = 'threadline_dev_stub_secret'

export class PaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentConfigurationError'
  }
}

export interface PaymentEnvironment {
  NODE_ENV?: string | undefined
  PAYMENT_PROVIDER?: string | undefined
  PAYMENT_WEBHOOK_SECRET?: string | undefined
  RAZORPAY_KEY_ID?: string | undefined
  RAZORPAY_KEY_SECRET?: string | undefined
}

/**
 * Build the gateway for this environment.
 *
 * The environment is a parameter rather than read from `process.env` inside, so the production
 * guard can be tested — which is the one behaviour here that must not be taken on trust.
 */
export function createPaymentGateway(env: PaymentEnvironment = process.env): PaymentGateway {
  const isProduction = env.NODE_ENV === 'production'
  const provider = (env.PAYMENT_PROVIDER ?? 'stub').trim().toLowerCase()

  if (provider === 'razorpay') {
    // J11 replaces this with `new RazorpayGateway(...)`. Until then, asking for Razorpay is a
    // configuration error rather than a silent downgrade to the stub.
    throw new PaymentConfigurationError(
      'PAYMENT_PROVIDER=razorpay is not implemented until J11. Unset it to use the stub gateway.',
    )
  }

  if (provider !== 'stub') {
    throw new PaymentConfigurationError(
      `Unknown PAYMENT_PROVIDER "${provider}". Expected one of: ${PAYMENT_PROVIDERS.join(', ')}.`,
    )
  }

  if (isProduction) {
    throw new PaymentConfigurationError(
      'The stub payment gateway cannot run in production. Set PAYMENT_PROVIDER to a real provider before deploying.',
    )
  }

  return new StubGateway({
    secret: env.PAYMENT_WEBHOOK_SECRET ?? DEV_STUB_SECRET,
    publicKey: env.RAZORPAY_KEY_ID ?? 'stub_key',
  })
}

/**
 * The process-wide gateway.
 *
 * Memoised so the webhook route and the checkout action share one instance and therefore one
 * signing secret. Cleared by `resetPaymentGateway` in tests, which is the only reason that
 * function exists.
 */
let cached: PaymentGateway | null = null

export function getPaymentGateway(): PaymentGateway {
  cached ??= createPaymentGateway()

  return cached
}

export function resetPaymentGateway(): void {
  cached = null
}
