import { describe, expect, it } from 'vitest'

import {
  clientIpFrom,
  clientKey,
  DEFAULT_TRUSTED_PROXY_HOPS,
  MemoryRateLimiterStore,
  normaliseIp,
  RATE_LIMITS,
  RateLimiter,
  trustedProxyHops,
  UNKNOWN_CLIENT,
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

describe('normaliseIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['  203.0.113.7  ', '203.0.113.7'],
    ['203.0.113.7:44321', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    ['2001:DB8::1', '2001:db8::1'],
    ['[2001:db8::1]:443', '2001:db8::1'],
  ])('accepts %o as %o', (input, expected) => {
    expect(normaliseIp(input)).toBe(expected)
  })

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['a hostname', 'evil.example.com'],
    ['arbitrary text', 'not-an-ip'],
    ['an out-of-range octet', '999.0.0.1'],
    ['a truncated address', '203.0.113'],
    ['an injected key', 'a".repeat(10)'],
  ])('rejects %s', (_label, input) => {
    // The point is not RFC compliance. It is that arbitrary text a caller controls cannot become a
    // rate-limit bucket of its own.
    expect(normaliseIp(input)).toBeNull()
  })

  it('rejects an absurdly long value rather than keying on it', () => {
    expect(normaliseIp('1'.repeat(200))).toBeNull()
  })
})

describe('clientIpFrom', () => {
  it('takes the entry the nearest trusted proxy appended, counting from the right', () => {
    // Railway appends the true peer address last, so with one trusted hop that is the real client.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9' })

    expect(clientIpFrom(headers, 1)).toBe('198.51.100.9')
  })

  it('resists a forged header — this is the bypass it exists to close', () => {
    // A script putting a fresh value in the header on every request used to get a fresh allowance
    // each time, defeating the coupon-apply limit whose whole purpose is to stop code guessing.
    // Railway appends the real address after whatever was supplied, so prepended junk only pushes
    // itself further from the end.
    const forged = ['9.9.9.9', 'evil.example.com', '1.1.1.1'].map(
      (spoof) => new Headers({ 'x-forwarded-for': `${spoof}, 198.51.100.9` }),
    )

    for (const headers of forged) {
      expect(clientIpFrom(headers, 1)).toBe('198.51.100.9')
    }

    // All three land in the same bucket, which is the property that matters.
    expect(new Set(forged.map((headers) => clientKey(headers, 'couponApply'))).size).toBe(1)
  })

  it('counts further left when more proxies are trusted', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9, 10.0.0.1' })

    expect(clientIpFrom(headers, 2)).toBe('198.51.100.9')
    expect(clientIpFrom(headers, 3)).toBe('203.0.113.7')
  })

  it('trusts nothing when there is no proxy in front', () => {
    // Zero hops means the header is entirely caller-written, so no entry in it is worth reading.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7' })

    expect(clientIpFrom(headers, 0)).toBeNull()
  })

  it('returns null when the chain is shorter than the trusted hop count', () => {
    // Fewer entries than expected means something is not as configured. Guessing at an entry anyway
    // is what would reopen the bypass, so it does not.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7' })

    expect(clientIpFrom(headers, 3)).toBeNull()
  })

  it('never falls back to another entry when the trusted one is not an IP', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, garbage' })

    expect(clientIpFrom(headers, 1)).toBeNull()
  })

  it('ignores empty entries when locating the trusted one', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': ' , 198.51.100.9' }), 1)).toBe('198.51.100.9')
  })

  it('returns null with no header at all', () => {
    expect(clientIpFrom(new Headers(), 1)).toBeNull()
  })
})

describe('trustedProxyHops', () => {
  it('defaults to one, for Railway edge alone', () => {
    expect(trustedProxyHops(undefined)).toBe(DEFAULT_TRUSTED_PROXY_HOPS)
    expect(trustedProxyHops('  ')).toBe(DEFAULT_TRUSTED_PROXY_HOPS)
  })

  it('reads an explicit count, including zero', () => {
    expect(trustedProxyHops('2')).toBe(2)
    expect(trustedProxyHops('0')).toBe(0)
  })

  it('falls back to the default on a malformed value, not to zero', () => {
    // Reading `one` as "trust nothing" would collapse every visitor into a single bucket — an
    // outage caused by a typo in an env var.
    expect(trustedProxyHops('one')).toBe(DEFAULT_TRUSTED_PROXY_HOPS)
    expect(trustedProxyHops('-3')).toBe(DEFAULT_TRUSTED_PROXY_HOPS)
  })
})

describe('clientKey', () => {
  it('salts the key, so one address gets a separate allowance per action', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.4' })

    expect(clientKey(headers, 'checkout')).toBe('checkout:198.51.100.4')
    expect(clientKey(headers, 'checkout')).not.toBe(clientKey(headers, 'cartMutation'))
  })

  it('puts every unattributable caller in one shared bucket', () => {
    // Deliberately the aggressive direction: a forged or absent header earns a *worse* allowance
    // than an honest one, never a private one.
    expect(clientKey(new Headers())).toBe(UNKNOWN_CLIENT)
    expect(clientKey(new Headers({ 'x-forwarded-for': 'garbage' }))).toBe(UNKNOWN_CLIENT)
  })

  it('still limits in local development, where there is no proxy', () => {
    const { limiter } = limiterAt()
    const headers = new Headers()

    expect(limiter.check(clientKey(headers, 'couponApply'), RULE).ok).toBe(true)
    expect(limiter.check(clientKey(headers, 'couponApply'), RULE).ok).toBe(true)
    expect(limiter.check(clientKey(headers, 'couponApply'), RULE).ok).toBe(true)
    expect(limiter.check(clientKey(headers, 'couponApply'), RULE).ok).toBe(false)
  })
})
