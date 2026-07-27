import { describe, expect, it } from 'vitest'

import {
  clientKey,
  MemoryRateLimiterStore,
  RATE_LIMITS,
  RateLimiter,
  type RateLimitRule,
} from '@/lib/http/rateLimit'

const RULE: RateLimitRule = { limit: 3, windowMs: 1000 }

/** A limiter whose clock the test drives, so windows are exact rather than slept through. */
function limiterAt(start = 0): { limiter: RateLimiter; advance: (ms: number) => void; store: MemoryRateLimiterStore } {
  let now = start
  const store = new MemoryRateLimiterStore()
  const limiter = new RateLimiter({ store, now: () => now })

  return { limiter, store, advance: (ms) => (now += ms) }
}

describe('RateLimiter', () => {
  it('allows exactly the limit and refuses the next', () => {
    const { limiter } = limiterAt()

    expect(limiter.check('a', RULE).ok).toBe(true)
    expect(limiter.check('a', RULE).ok).toBe(true)
    expect(limiter.check('a', RULE).ok).toBe(true)
    expect(limiter.check('a', RULE).ok).toBe(false)
  })

  it('reports the remaining allowance as it is spent', () => {
    const { limiter } = limiterAt()

    expect(limiter.check('a', RULE).remaining).toBe(2)
    expect(limiter.check('a', RULE).remaining).toBe(1)
    expect(limiter.check('a', RULE).remaining).toBe(0)
  })

  it('keys are independent — one caller cannot exhaust another', () => {
    const { limiter } = limiterAt()

    for (let i = 0; i < 5; i += 1) limiter.check('noisy', RULE)

    expect(limiter.check('quiet', RULE).ok).toBe(true)
  })

  it('counts a refused request, so being over the limit is not free', () => {
    const { limiter } = limiterAt()

    for (let i = 0; i < 3; i += 1) limiter.check('a', RULE)

    // Hammering through the whole window must not let the caller back in the instant it turns.
    for (let i = 0; i < 20; i += 1) {
      limiter.check('a', RULE)
    }

    expect(limiter.check('a', RULE).ok).toBe(false)
  })

  it('recovers once a full window has passed in silence', () => {
    const { limiter, advance } = limiterAt()

    for (let i = 0; i < 3; i += 1) limiter.check('a', RULE)
    expect(limiter.check('a', RULE).ok).toBe(false)

    // Two windows of quiet clears the history entirely.
    advance(2000)

    expect(limiter.check('a', RULE).ok).toBe(true)
  })

  it('holds the rate across a window boundary — the failure a fixed window has', () => {
    const { limiter, advance } = limiterAt()

    // Spend the whole allowance at the very end of the window.
    advance(999)
    for (let i = 0; i < 3; i += 1) expect(limiter.check('a', RULE).ok).toBe(true)

    // A fixed-window counter resets here and would allow three more immediately, doubling the
    // intended rate across the boundary. The sliding window still sees the previous burst.
    advance(2)

    expect(limiter.check('a', RULE).ok).toBe(false)
  })

  it('lets the previous window decay rather than dropping it all at once', () => {
    const { limiter, advance } = limiterAt()

    for (let i = 0; i < 3; i += 1) limiter.check('a', RULE)

    // Most of the way through the next window: the old burst is weighted down to ~0.3 of 3,
    // leaving room again.
    advance(1900)

    expect(limiter.check('a', RULE).ok).toBe(true)
  })

  it('gives a retry hint that is never zero', () => {
    const { limiter } = limiterAt()

    for (let i = 0; i < 3; i += 1) limiter.check('a', RULE)
    const refused = limiter.check('a', RULE)

    expect(refused.ok).toBe(false)
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('sweeps entries nothing has touched, so the store is not an unbounded allocation', () => {
    const { limiter, store, advance } = limiterAt()

    limiter.check('stale', RULE)
    advance(5000)
    limiter.check('fresh', RULE)

    limiter.sweep(RULE.windowMs)

    expect(store.size).toBe(1)
    expect(store.get('fresh')).toBeDefined()
    expect(store.get('stale')).toBeUndefined()
  })
})

describe('RATE_LIMITS', () => {
  it('holds coupon application tighter than ordinary cart edits', () => {
    // An unlimited apply is an oracle for guessing valid codes; a stepper genuinely fires often.
    expect(RATE_LIMITS.couponApply.limit).toBeLessThan(RATE_LIMITS.cartMutation.limit)
  })

  it('declares a positive limit and window for every rule', () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThan(0)
      expect(rule.windowMs).toBeGreaterThan(0)
    }
  })
})

describe('clientKey', () => {
  it('takes the left-most forwarded address — the original client, not the nearest proxy', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })

    expect(clientKey(headers)).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientKey(new Headers())).toBe('unknown')
  })

  it('salts the key, so one address gets a separate allowance per action', () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.4' })

    expect(clientKey(headers, 'checkout')).toBe('checkout:198.51.100.4')
    expect(clientKey(headers, 'checkout')).not.toBe(clientKey(headers, 'cartMutation'))
  })

  it('ignores an empty forwarded entry rather than keying everyone on the empty string', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': ' , 10.0.0.1' }))).toBe('unknown')
  })
})
