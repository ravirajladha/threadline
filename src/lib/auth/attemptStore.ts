/**
 * Where login attempt state lives.
 *
 * In memory, keyed by normalised address, with an injected clock — the same shape as
 * `http/rateLimit.ts`, and for the same reason: the alternative is a table and a migration for data
 * whose entire lifetime is ten minutes.
 *
 * **Two honest limitations**, stated here rather than discovered later:
 *
 * - **Per process.** Two app instances keep two counters, so the effective lockout ceiling is
 *   `MAX_OTP_ATTEMPTS × instances`. On a single Railway container today that is exact; the day this
 *   scales horizontally, this moves to the database or Redis. The rate limiter has the same
 *   property and the same note.
 * - **Cleared on deploy.** A restart forgets every lockout. That fails *open*, which is the wrong
 *   direction — but the code is also forgotten, so an attacker gains a fresh counter against a code
 *   that no longer verifies. The window is a real one and it is small; a persistent store is the fix
 *   and it belongs with the persistent OTP that J11 brings.
 *
 * Entries are swept opportunistically rather than on a timer, because a timer keeps the process
 * alive and this is not worth a process handle.
 */
import { issueState, isLockedOut, type AttemptState } from './login'

/** How long an untouched entry is kept before a sweep may drop it. */
const ENTRY_TTL_MS = 60 * 60_000

export class LoginAttemptStore {
  private readonly entries = new Map<string, AttemptState & { touchedAt: number }>()
  private readonly now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  /** The state for an address, or a clean slate. Never null, so callers have no empty branch. */
  get(address: string): AttemptState {
    const entry = this.entries.get(address)

    if (entry === undefined) return { issuedAt: null, attempts: 0, lockedUntil: null }

    const { touchedAt: _touchedAt, ...state } = entry

    return state
  }

  set(address: string, state: AttemptState): void {
    this.entries.set(address, { ...state, touchedAt: this.now() })
  }

  /** Record that a fresh code was sent. */
  issue(address: string): void {
    this.set(address, issueState(this.now()))
  }

  /**
   * Whether this address is locked out right now.
   *
   * Exposed so the *request-code* path can refuse too: without it, a script locked out of verifying
   * simply requests a new code and starts again, and the lockout means nothing.
   */
  locked(address: string): boolean {
    return isLockedOut(this.get(address), this.now())
  }

  /** Forget an address. Called on a successful login so a clean session starts clean. */
  clear(address: string): void {
    this.entries.delete(address)
  }

  /** Drop entries nothing has touched for an hour. */
  sweep(): void {
    const cutoff = this.now() - ENTRY_TTL_MS

    for (const [address, entry] of this.entries) {
      // A live lockout is kept regardless of age — expiring it early would be the sweep handing out
      // an early release.
      if (entry.touchedAt < cutoff && !isLockedOut(entry, this.now())) this.entries.delete(address)
    }
  }

  /** Test seam. */
  get size(): number {
    return this.entries.size
  }
}

/**
 * The process-wide store.
 *
 * Module scope, so counters survive between requests — a store constructed per request counts to
 * one and permits everything, which looks like it is working right up until it matters.
 */
export const loginAttempts = new LoginAttemptStore()
