/**
 * The decisions around a login attempt, as pure functions.
 *
 * Auth is the one surface where the *shape of the answer* is itself a security property, so the
 * reasoning belongs somewhere it can be tested exhaustively rather than inside a route handler.
 *
 * Three rules, each of which is a way login is usually got wrong:
 *
 * **No user enumeration** (OWASP A07). Requesting a code answers "we've sent one" whether or not
 * the address belongs to an account. The tempting version — "no account found, please register" —
 * turns the login form into a free customer list: an attacker walks a list of addresses and learns
 * who shops here, which is worth money on its own and is the first step in a credential-stuffing
 * campaign. The same applies to timing, which is why the caller does the same work either way.
 *
 * **A wrong code and an expired code are the same answer.** Distinguishing them tells an attacker
 * whether they are guessing against a live code — that is, whether to keep going.
 *
 * **Attempts are bounded.** A six-digit code is a million possibilities, which sounds ample until
 * it is guessed at machine speed: unbounded, it falls in minutes. The lockout is a typed refusal
 * with the wait attached, not a thrown error, because the caller has to answer politely either way.
 */

/** Attempts against one code before it is dead. Low, because a legitimate person types it once. */
export const MAX_OTP_ATTEMPTS = 5

/** How long a code is good for. Long enough to switch to an email client and back. */
export const OTP_TTL_MS = 10 * 60_000

/** How long a locked address waits. Long enough to be useless to a script, short enough to forgive. */
export const LOCKOUT_MS = 15 * 60_000

/** What we know about an address when a code is being checked. */
export interface AttemptState {
  /** When the current code was issued, or null if none was. */
  issuedAt: number | null
  /** Failed verifications against the current code. */
  attempts: number
  /** When a lockout expires, or null if not locked. */
  lockedUntil: number | null
}

export type LoginRefusal =
  /** Too many wrong codes. Carries the wait so the caller can say how long. */
  | { reason: 'locked_out'; retryAfterMs: number }
  /** No code was ever requested for this address. Reads identically to a wrong code to the caller. */
  | { reason: 'no_code' }
  /** Wrong, expired, or malformed — deliberately one reason, not three. */
  | { reason: 'invalid_code' }

export type LoginDecision =
  | { ok: true }
  | { ok: false; refusal: LoginRefusal; nextState: AttemptState }

/** A fresh state for an address that has just been sent a code. */
export function issueState(now: number): AttemptState {
  return { issuedAt: now, attempts: 0, lockedUntil: null }
}

/** Whether the address is currently locked out. */
export function isLockedOut(state: AttemptState, now: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now
}

/**
 * Decide a verification attempt.
 *
 * `codeMatches` is passed in rather than computed here, so this stays pure and the channel keeps
 * ownership of what a valid code *is*. The order of checks matters: lockout is tested before the
 * code, so a locked-out attacker learns nothing more by guessing correctly.
 */
export function decideLogin(input: {
  state: AttemptState
  codeMatches: boolean
  now: number
  ttlMs?: number
  maxAttempts?: number
  lockoutMs?: number
}): LoginDecision {
  const {
    state,
    codeMatches,
    now,
    ttlMs = OTP_TTL_MS,
    maxAttempts = MAX_OTP_ATTEMPTS,
    lockoutMs = LOCKOUT_MS,
  } = input

  if (isLockedOut(state, now)) {
    return {
      ok: false,
      refusal: { reason: 'locked_out', retryAfterMs: (state.lockedUntil ?? now) - now },
      nextState: state,
    }
  }

  if (state.issuedAt === null) {
    // No code outstanding. Counted as an attempt anyway, so probing addresses at random is bounded
    // by the same lockout as guessing a code.
    return { ok: false, refusal: { reason: 'no_code' }, nextState: countFailure(state, now, maxAttempts, lockoutMs) }
  }

  const expired = now - state.issuedAt > ttlMs

  if (expired || !codeMatches) {
    return {
      ok: false,
      // One reason for both, deliberately.
      refusal: { reason: 'invalid_code' },
      nextState: countFailure(state, now, maxAttempts, lockoutMs),
    }
  }

  return { ok: true }
}

/** Record a failure, locking out once the ceiling is reached. */
function countFailure(state: AttemptState, now: number, maxAttempts: number, lockoutMs: number): AttemptState {
  const attempts = state.attempts + 1

  if (attempts < maxAttempts) return { ...state, attempts }

  // Locked, and the code is cleared with it: surviving a lockout must not leave the same code live
  // for the next window, which would make the lockout a pause rather than a reset.
  return { issuedAt: null, attempts: 0, lockedUntil: now + lockoutMs }
}

/**
 * The single message a caller shows for any failed verification.
 *
 * One sentence for every refusal except lockout, which has to say how long or the customer simply
 * retries into it. Nothing here says whether the address exists.
 */
export function describeLoginRefusal(refusal: LoginRefusal): string {
  switch (refusal.reason) {
    case 'locked_out': {
      const minutes = Math.max(1, Math.ceil(refusal.retryAfterMs / 60_000))

      return `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }
    case 'no_code':
    case 'invalid_code':
      return 'That code is not right, or it has expired. Request a new one.'
  }
}

/**
 * Normalise an address for lookup and for keying attempts.
 *
 * Lower-cased and trimmed so `Asha@Example.com` and `asha@example.com` are one account and one
 * attempt counter — otherwise the lockout is bypassed by varying the capitalisation.
 */
export function normaliseLoginAddress(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** Loose on purpose: rejecting valid-but-unusual addresses locks real customers out of their own shop. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
