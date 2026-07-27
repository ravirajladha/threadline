/**
 * Choosing a shipping provider.
 *
 * The same rule as `payments/factory.ts`, for the same reason: **a stub must be impossible to reach
 * in production.** The factory throws at startup when `NODE_ENV=production` and no real courier is
 * configured, rather than quietly falling back — a store that fabricates AWBs in production is worse
 * than one that refuses to boot, because the failure surfaces as customers chasing parcels that were
 * never collected.
 *
 * Selection is by environment only. There is deliberately no branch inside fulfilment logic asking
 * "are we stubbing?", because that branch is how a stub eventually runs somewhere it should not.
 */
import { StubShippingProvider } from './stubProvider'
import type { ShippingProvider } from './types'

export const SHIPPING_PROVIDERS = ['stub', 'shiprocket'] as const
export type ShippingProviderName = (typeof SHIPPING_PROVIDERS)[number]

/** A development signing secret, so the stub's signature checks are real without any setup. */
const DEV_STUB_SECRET = 'threadline_dev_shipping_secret'

export class ShippingConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShippingConfigurationError'
  }
}

export interface ShippingEnvironment {
  NODE_ENV?: string | undefined
  SHIPPING_PROVIDER?: string | undefined
  SHIPPING_WEBHOOK_SECRET?: string | undefined
  SHIPROCKET_EMAIL?: string | undefined
  SHIPROCKET_PASSWORD?: string | undefined
}

/**
 * Build the provider for this environment.
 *
 * The environment is a parameter rather than read from `process.env` inside, so the production guard
 * can be tested — the one behaviour here that must not be taken on trust.
 */
export function createShippingProvider(env: ShippingEnvironment = process.env): ShippingProvider {
  const isProduction = env.NODE_ENV === 'production'
  const provider = (env.SHIPPING_PROVIDER ?? 'stub').trim().toLowerCase()

  if (provider === 'shiprocket') {
    // J11 replaces this with `new ShiprocketProvider(...)`. Until then, asking for Shiprocket is a
    // configuration error rather than a silent downgrade to the stub.
    throw new ShippingConfigurationError(
      'SHIPPING_PROVIDER=shiprocket is not implemented until J11. Unset it to use the stub provider.',
    )
  }

  if (provider !== 'stub') {
    throw new ShippingConfigurationError(
      `Unknown SHIPPING_PROVIDER "${provider}". Expected one of: ${SHIPPING_PROVIDERS.join(', ')}.`,
    )
  }

  if (isProduction) {
    throw new ShippingConfigurationError(
      'The stub shipping provider cannot run in production. Set SHIPPING_PROVIDER to a real provider before deploying.',
    )
  }

  return new StubShippingProvider({ secret: env.SHIPPING_WEBHOOK_SECRET ?? DEV_STUB_SECRET })
}

/**
 * The process-wide provider.
 *
 * Memoised so the tracking webhook route and the fulfilment action share one instance and therefore
 * one signing secret. Cleared by `resetShippingProvider` in tests, which is the only reason that
 * function exists.
 */
let cached: ShippingProvider | null = null

export function getShippingProvider(): ShippingProvider {
  cached ??= createShippingProvider()

  return cached
}

export function resetShippingProvider(): void {
  cached = null
}
