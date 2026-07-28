/**
 * Choosing the OTP channel.
 *
 * The fourth factory with the same rule, for the sharpest reason yet: **the stub accepts `000000`.**
 * A payment stub that reaches production fabricates payments and a notification stub swallows email,
 * but an auth stub reaching production hands every account in the shop to anyone who can type six
 * zeroes. So this throws at startup rather than falling back, and the guard is the one behaviour
 * here that must not be taken on trust — hence the environment is a parameter.
 */
import { StubOtpChannel } from './otp'
import type { OtpChannel } from './otp'

export const OTP_PROVIDERS = ['stub', 'resend'] as const
export type OtpProviderName = (typeof OTP_PROVIDERS)[number]

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthConfigurationError'
  }
}

export interface AuthEnvironment {
  NODE_ENV?: string | undefined
  OTP_PROVIDER?: string | undefined
}

export function createOtpChannel(env: AuthEnvironment = process.env): OtpChannel {
  const isProduction = env.NODE_ENV === 'production'
  const provider = (env.OTP_PROVIDER ?? 'stub').trim().toLowerCase()

  if (provider === 'resend') {
    throw new AuthConfigurationError(
      'OTP_PROVIDER=resend is not implemented until J11. Unset it to use the stub channel.',
    )
  }

  if (provider !== 'stub') {
    throw new AuthConfigurationError(
      `Unknown OTP_PROVIDER "${provider}". Expected one of: ${OTP_PROVIDERS.join(', ')}.`,
    )
  }

  if (isProduction) {
    throw new AuthConfigurationError(
      'The stub OTP channel accepts a fixed code and cannot run in production. Set OTP_PROVIDER to a real provider before deploying.',
    )
  }

  return new StubOtpChannel()
}

/**
 * The process-wide channel.
 *
 * Memoised, unlike the notification dispatcher: a real channel will hold a provider client and a
 * signing secret, and the request that sends a code and the request that verifies it must share
 * them. Cleared by `resetOtpChannel` in tests, which is the only reason that function exists.
 */
let cached: OtpChannel | null = null

export function getOtpChannel(): OtpChannel {
  cached ??= createOtpChannel()

  return cached
}

export function resetOtpChannel(): void {
  cached = null
}
