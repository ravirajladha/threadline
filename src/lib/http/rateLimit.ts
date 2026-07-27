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
 * How many proxies in front of this app we control, and therefore trust.
 *
 * One for Railway, whose edge is the only thing between the internet and the app (owner confirmed
 * 2026-07-27: no custom domain, no Cloudflare in front — Cloudflare is used for R2 media only).
 *
 * Zero means "no trusted proxy", which makes `x-forwarded-for` worthless rather than merely
 * imperfect: with nothing rewriting the header, every entry in it is whatever the caller typed. That
 * case deliberately falls back to a single shared bucket instead of trusting an entry anyway.
 */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1

/** The bucket everything unattributable shares. Aggressive on purpose — see `clientKey`. */
export const UNKNOWN_CLIENT = 'unknown'

/**
 * Takes the raw setting rather than an environment object, because one value is all it needs — and a
 * test that has to build an env bag to exercise a parser is testing the bag.
 */
export function trustedProxyHops(raw = process.env.TRUSTED_PROXY_HOPS): number {
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_TRUSTED_PROXY_HOPS

  const parsed = Number.parseInt(raw.trim(), 10)

  // A malformed value falls back to the default rather than to zero. Zero is a meaningful setting
  // here, and reading `TRUSTED_PROXY_HOPS=one` as "trust nothing" would silently collapse every
  // visitor into one bucket — a self-inflicted outage from a typo.
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_TRUSTED_PROXY_HOPS
}

/**
 * Whether a string is plausibly an IP address, with any port stripped.
 *
 * Not a full RFC parser — the point is to reject the arbitrary text a caller can put in the header,
 * so that a forged entry becomes `UNKNOWN_CLIENT` rather than its own private allowance.
 */
export function normaliseIp(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 64) return null

  // `[::1]:443` — a bracketed IPv6 with a port.
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(trimmed)
  if (bracketed?.[1] !== undefined) return bracketed[1].toLowerCase()

  // `1.2.3.4:5678` — IPv4 with a port. Bare IPv6 also contains colons, hence the dot check.
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed)
  const candidate = withPort?.[1] ?? trimmed

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate)
  if (ipv4 !== null) {
    const octets = ipv4.slice(1, 5).map((part) => Number.parseInt(part, 10))

    return octets.every((octet) => octet >= 0 && octet <= 255) ? octets.join('.') : null
  }

  // IPv6: hex groups and colons only, at least one colon. Deliberately permissive about the exact
  // form — a valid-enough address is a stable key, which is all this needs to be.
  if (/^[0-9a-fA-F:]+$/.test(candidate) && candidate.includes(':')) return candidate.toLowerCase()

  return null
}

/**
 * The caller's IP, taken from the right-hand end of `x-forwarded-for`.
 *
 * **Why the right and not the left.** The header is a list that each proxy appends to, so the
 * left-most entry is the one furthest from us — and on a request that arrived with the header
 * already populated, that entry is simply whatever the client sent. Taking it meant a script could
 * put a fresh value in `x-forwarded-for` on every request and receive a fresh allowance each time,
 * which defeated the coupon-apply limit whose entire purpose is to stop code guessing.
 *
 * Counting `hops` from the right instead lands on the entry appended by the proxy nearest us, which
 * is the last one an outsider cannot forge: Railway's edge appends the true peer address after
 * anything the caller supplied, so with one trusted hop the right-most entry is the real client and
 * prepended junk only pushes itself further left.
 *
 * Returns null rather than falling back to another entry when the chain is too short or the value is
 * not an IP. Falling back is what reintroduces the bypass — an attacker who wants to be
 * unattributable can only reach the shared bucket, never a private one.
 */
export function clientIpFrom(headers: Headers, hops = trustedProxyHops()): string | null {
  if (hops <= 0) return null

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded === null) return null

  const entries = forwarded
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  // With `hops` proxies each appending one entry, the client sits `hops` from the end.
  const candidate = entries[entries.length - hops]
  if (candidate === undefined) return null

  return normaliseIp(candidate)
}

/**
 * The caller's identity for limiting purposes.
 *
 * Salted per limit name so a shopper's cart activity cannot exhaust their coupon allowance.
 *
 * An unattributable caller gets `UNKNOWN_CLIENT`, which every other unattributable caller shares.
 * That is deliberately the aggressive direction: it means a forged header buys a *worse* allowance
 * than an honest one, and in local development — where there is no proxy and no
 * `x-forwarded-for` — it means the limiter still works, just globally.
 */
export function clientKey(headers: Headers, salt = ''): string {
  const ip = clientIpFrom(headers) ?? UNKNOWN_CLIENT

  return salt.length > 0 ? `${salt}:${ip}` : ip
}
