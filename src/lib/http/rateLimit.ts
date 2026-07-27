/**
 * Rate limiting for public mutations (OWASP A07, and CLAUDE.md §2's standing rule).
 *
 * A **sliding window counter** rather than a fixed one. A fixed window lets a caller spend its
 * whole allowance at 0:59 and the next window's at 1:01 — double the intended rate across the
 * boundary, which is precisely when a scripted caller will hit it. The sliding version weights
 * the previous window by how much of it is still in view, so the rate holds wherever the burst
 * lands.
 *
 * The store is a `Map` in process memory. That is honest for one Node instance and **wrong across
 * several**: behind two containers a caller gets two allowances. It is deliberately the simple
 * thing for now — the limiter's job here is to stop a loop hammering add-to-cart, not to be a
 * security boundary on its own — and `RateLimiterStore` is the seam where Redis replaces it
 * without touching a call site.
 *
 * Everything takes its clock through the constructor, so the tests assert on exact windows
 * rather than sleeping.
 */

export interface RateLimitDecision {
  ok: boolean
  /** Requests still available in the current window, floored at zero. */
  remaining: number
  /** Whole seconds until the caller should try again. Zero when `ok`. */
  retryAfterSeconds: number
}

export interface RateLimitRule {
  /** How many requests are allowed per window. */
  limit: number
  windowMs: number
}

interface WindowState {
  /** Start of the current window, in ms. */
  windowStart: number
  currentCount: number
  previousCount: number
}

/** The seam a distributed store would implement. Synchronous, because the Map one is. */
export interface RateLimiterStore {
  get(key: string): WindowState | undefined
  set(key: string, state: WindowState): void
  delete(key: string): void
  /** Every key currently held, so a sweep can drop the stale ones. */
  keys(): Iterable<string>
}

export class MemoryRateLimiterStore implements RateLimiterStore {
  private readonly entries = new Map<string, WindowState>()

  get(key: string): WindowState | undefined {
    return this.entries.get(key)
  }

  set(key: string, state: WindowState): void {
    this.entries.set(key, state)
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  keys(): Iterable<string> {
    return this.entries.keys()
  }

  get size(): number {
    return this.entries.size
  }
}

export class RateLimiter {
  private readonly store: RateLimiterStore
  private readonly now: () => number

  constructor(options: { store?: RateLimiterStore; now?: () => number } = {}) {
    this.store = options.store ?? new MemoryRateLimiterStore()
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Count one request against `key` and say whether it is allowed.
   *
   * A refused request is **still counted**. Not counting it would let a caller that is already
   * over the limit keep the endpoint busy for free, which is the one thing the limiter exists to
   * prevent.
   */
  check(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.now()
    const state = this.rollForward(this.store.get(key), now, rule.windowMs)

    // How much of the previous window is still inside the trailing window, 1 → 0 across it.
    const elapsed = now - state.windowStart
    const previousWeight = Math.max(0, 1 - elapsed / rule.windowMs)
    const weighted = state.previousCount * previousWeight + state.currentCount

    // The request being decided is the one after those already counted.
    const ok = weighted + 1 <= rule.limit

    this.store.set(key, { ...state, currentCount: state.currentCount + 1 })

    if (ok) {
      return {
        ok: true,
        remaining: Math.max(0, Math.floor(rule.limit - weighted - 1)),
        retryAfterSeconds: 0,
      }
    }

    return {
      ok: false,
      remaining: 0,
      // Wait out the remainder of this window. An approximation, but never zero, so a client
      // honouring the header always backs off by something.
      retryAfterSeconds: Math.max(1, Math.ceil((rule.windowMs - elapsed) / 1000)),
    }
  }

  /**
   * Advance a stored window to the present.
   *
   * One window on means the current count becomes the previous one; two or more means the whole
   * history has aged out and the counter starts clean.
   */
  private rollForward(state: WindowState | undefined, now: number, windowMs: number): WindowState {
    if (state === undefined) return { windowStart: now, currentCount: 0, previousCount: 0 }

    const windowsElapsed = Math.floor((now - state.windowStart) / windowMs)

    if (windowsElapsed <= 0) return state
    if (windowsElapsed === 1) {
      return {
        windowStart: state.windowStart + windowMs,
        currentCount: 0,
        previousCount: state.currentCount,
      }
    }

    return { windowStart: now, currentCount: 0, previousCount: 0 }
  }

  /**
   * Drop entries no request has touched for two windows.
   *
   * Without this the Map is an unbounded allocation keyed by something a caller controls, which
   * turns a rate limiter into a memory leak with extra steps.
   */
  sweep(windowMs: number): void {
    const cutoff = this.now() - windowMs * 2

    for (const key of [...this.store.keys()]) {
      const state = this.store.get(key)
      if (state !== undefined && state.windowStart < cutoff) this.store.delete(key)
    }
  }
}

/**
 * The rules, in one place so they are tunable without hunting through route handlers.
 *
 * Cart mutations are generous — a shopper adjusting quantities with the stepper genuinely fires
 * several a second — while the ones that cost something, or that are worth guessing at, are not.
 * Coupon apply is the tightest: an unlimited one is a code-guessing oracle.
 */
export const RATE_LIMITS = {
  cartMutation: { limit: 60, windowMs: 60_000 },
  couponApply: { limit: 10, windowMs: 60_000 },
  checkout: { limit: 8, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>

/**
 * The caller's identity for limiting purposes.
 *
 * `x-forwarded-for` is spoofable by the client and trustworthy only in as much as the proxy in
 * front rewrites it — so this is a throttle, not an access control, and nothing security-relevant
 * is decided from it. The **left-most** entry is taken because that is the original client; the
 * right-most is the nearest proxy and would bucket every visitor together.
 */
export function clientKey(headers: Headers, salt = ''): string {
  const forwarded = headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  const ip = first !== undefined && first.length > 0 ? first : (headers.get('x-real-ip') ?? 'unknown')

  return salt.length > 0 ? `${salt}:${ip}` : ip
}
