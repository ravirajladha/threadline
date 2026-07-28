/**
 * The one-time-code contract.
 *
 * Per CLAUDE.md §2, login is built and walkable before any delivery provider exists: the stub
 * accepts a fixed code in development and issues a **real** session cookie, so every surface behind
 * a login is exercised now rather than after an SMS account is opened.
 *
 * The interface is drawn around what a real provider owns, and — as with payments and shipping —
 * around what a stub must not be able to fake:
 *
 * - **Delivery is theirs.** `send` hands a code to an address and can fail.
 * - **Verification is ours**, and it is the security boundary. `verify` answers a plain boolean and
 *   is expected to compare in constant time, because a code short enough for a person to type is
 *   short enough to guess if the comparison leaks how close a guess was.
 * - **A code is never returned to the caller.** `send` yields no code and the type has nowhere to
 *   put one, so an endpoint cannot accidentally echo it into a response body — which is exactly the
 *   shortcut a development build invites and production then ships.
 */
import { safeCompareHex } from '@/lib/payments/signature'

/** Where a code is going. Email today; SMS and WhatsApp are the same shape at J11. */
export interface OtpTarget {
  /** Email address or phone number, already normalised by the caller. */
  address: string
}

export type OtpSendOutcome =
  | { ok: true }
  /** A message for the log, never for the caller — see `login.ts` on enumeration. */
  | { ok: false; error: string }

export interface OtpChannel {
  readonly name: string

  /**
   * Send a code.
   *
   * Takes no code argument: generating one is the channel's business, because a real provider may
   * generate it server-side, and a caller that can choose the code can choose `000000` in
   * production.
   */
  send(target: OtpTarget): Promise<OtpSendOutcome>

  /**
   * Whether `code` is the valid code for `target` right now.
   *
   * Async because a real implementation reads a stored hash and its expiry. Returning a boolean
   * rather than a reason is deliberate: "expired" and "wrong" are the same answer to a caller, and
   * distinguishing them tells an attacker whether they are guessing against a live code.
   */
  verify(target: OtpTarget, code: string): Promise<boolean>
}

/** How long a code a person has to type should be. Six digits is the convention customers expect. */
export const OTP_LENGTH = 6

/** The fixed development code, per CLAUDE.md §2. Never reachable in production — see `factory.ts`. */
export const STUB_OTP_CODE = '000000'

/**
 * Narrow untrusted input to something that could be a code.
 *
 * Checked before any comparison so a caller cannot submit a 10,000-character string and make the
 * comparison itself the denial of service.
 */
export function isPlausibleOtp(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9]{${OTP_LENGTH}}$`).test(value)
}

/**
 * The development channel.
 *
 * Accepts anything as a send, and verifies exactly one code. It stores nothing, which is the honest
 * shape here: there is no secret to keep, so pretending to keep one would be theatre. What it does
 * keep real is the *comparison* — constant time, and against a properly shaped input — so the code
 * path J11 inherits is the one already under test.
 */
export class StubOtpChannel implements OtpChannel {
  readonly name = 'stub'

  private readonly log: (message: string) => void

  constructor(options: { log?: (message: string) => void } = {}) {
    this.log = options.log ?? ((message) => console.info(message))
  }

  send(target: OtpTarget): Promise<OtpSendOutcome> {
    if (target.address.trim().length === 0) {
      return Promise.resolve({ ok: false, error: 'No address to send a code to' })
    }

    // Printed for the developer, exactly as `ConsoleChannel` prints an email. The address appears
    // here and nowhere else — the structured log never carries it (OWASP A09).
    this.log(`\n  ⟢ sign-in code for ${target.address}: ${STUB_OTP_CODE}\n`)

    return Promise.resolve({ ok: true })
  }

  verify(_target: OtpTarget, code: string): Promise<boolean> {
    if (!isPlausibleOtp(code)) return Promise.resolve(false)

    // Constant time even though the expected value is a public constant here, because this is the
    // line J11 replaces with a real comparison and the habit is the point.
    return Promise.resolve(safeCompareHex(code, STUB_OTP_CODE))
  }
}
