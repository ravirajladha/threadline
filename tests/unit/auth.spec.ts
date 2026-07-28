/**
 * Auth — the login decisions, the attempt store, the OTP channel and its factory.
 *
 * Almost every test here is about *not* revealing something or *not* allowing something. Login is
 * the one surface where the shape of a refusal is itself the security property, so the refusals get
 * more attention than the happy path.
 */
import { describe, expect, it, vi } from 'vitest'

import { LoginAttemptStore } from '@/lib/auth/attemptStore'
import { AuthConfigurationError, createOtpChannel } from '@/lib/auth/factory'
import {
  decideLogin,
  describeLoginRefusal,
  issueState,
  isLockedOut,
  looksLikeEmail,
  LOCKOUT_MS,
  MAX_OTP_ATTEMPTS,
  normaliseLoginAddress,
  OTP_TTL_MS,
  type AttemptState,
} from '@/lib/auth/login'
import { isPlausibleOtp, StubOtpChannel, STUB_OTP_CODE } from '@/lib/auth/otp'

const NOW = 1_800_000_000_000

const fresh = (overrides: Partial<AttemptState> = {}): AttemptState => ({
  issuedAt: NOW,
  attempts: 0,
  lockedUntil: null,
  ...overrides,
})

describe('decideLogin', () => {
  it('accepts the right code against a live request', () => {
    expect(decideLogin({ state: fresh(), codeMatches: true, now: NOW + 1_000 })).toEqual({ ok: true })
  })

  it('refuses a wrong code', () => {
    const decision = decideLogin({ state: fresh(), codeMatches: false, now: NOW + 1_000 })

    expect(decision).toMatchObject({ ok: false, refusal: { reason: 'invalid_code' } })
  })

  it('gives an expired code the same answer as a wrong one', () => {
    // Distinguishing them tells an attacker whether they are guessing against a live code — that
    // is, whether it is worth continuing.
    const expired = decideLogin({ state: fresh(), codeMatches: true, now: NOW + OTP_TTL_MS + 1 })
    const wrong = decideLogin({ state: fresh(), codeMatches: false, now: NOW + 1_000 })

    expect(expired).toMatchObject({ refusal: { reason: 'invalid_code' } })
    expect(describeLoginRefusal({ reason: 'invalid_code' })).toBe(
      describeLoginRefusal(wrong.ok ? { reason: 'invalid_code' } : wrong.refusal),
    )
  })

  it('counts an attempt against an address with no outstanding code', () => {
    // So walking addresses at random is bounded by the same lockout as guessing a code.
    const decision = decideLogin({ state: fresh({ issuedAt: null }), codeMatches: false, now: NOW })

    expect(decision).toMatchObject({ ok: false, refusal: { reason: 'no_code' } })
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.nextState.attempts).toBe(1)
  })

  it('locks out on the fifth wrong code', () => {
    let state = fresh()

    for (let attempt = 1; attempt < MAX_OTP_ATTEMPTS; attempt += 1) {
      const decision = decideLogin({ state, codeMatches: false, now: NOW })
      if (decision.ok) throw new Error('expected a refusal')
      state = decision.nextState
      expect(state.lockedUntil).toBeNull()
    }

    const final = decideLogin({ state, codeMatches: false, now: NOW })
    if (final.ok) throw new Error('expected a refusal')

    expect(final.nextState.lockedUntil).toBe(NOW + LOCKOUT_MS)
  })

  it('clears the outstanding code when it locks out', () => {
    // Otherwise surviving the lockout leaves the same code live for the next window, which makes
    // the lockout a pause rather than a reset.
    const state = fresh({ attempts: MAX_OTP_ATTEMPTS - 1 })
    const decision = decideLogin({ state, codeMatches: false, now: NOW })

    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.nextState.issuedAt).toBeNull()
  })

  it('refuses a locked-out address even when the code is right', () => {
    // The lockout is checked before the code, so guessing correctly while locked reveals nothing.
    const decision = decideLogin({
      state: fresh({ lockedUntil: NOW + 60_000 }),
      codeMatches: true,
      now: NOW,
    })

    expect(decision).toMatchObject({ ok: false, refusal: { reason: 'locked_out' } })
  })

  it('lets an expired lockout through', () => {
    expect(isLockedOut(fresh({ lockedUntil: NOW - 1 }), NOW)).toBe(false)
    expect(decideLogin({ state: fresh({ lockedUntil: NOW - 1 }), codeMatches: true, now: NOW })).toEqual({
      ok: true,
    })
  })

  it('says how long a lockout has left', () => {
    const decision = decideLogin({
      state: fresh({ lockedUntil: NOW + 120_000 }),
      codeMatches: false,
      now: NOW,
    })

    if (decision.ok) throw new Error('expected a refusal')
    expect(describeLoginRefusal(decision.refusal)).toContain('2 minutes')
  })

  it('never names the address or says whether it exists', () => {
    for (const reason of [
      { reason: 'no_code' as const },
      { reason: 'invalid_code' as const },
      { reason: 'locked_out' as const, retryAfterMs: 60_000 },
    ]) {
      const message = describeLoginRefusal(reason)

      expect(message).not.toMatch(/account|registered|exist|unknown/i)
    }
  })
})

describe('address handling', () => {
  it('folds case and whitespace so one address is one counter', () => {
    // Otherwise the lockout is bypassed by varying the capitalisation.
    expect(normaliseLoginAddress('  Asha@Example.COM ')).toBe('asha@example.com')
  })

  it('is empty for anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(normaliseLoginAddress(value)).toBe('')
    }
  })

  it('accepts ordinary addresses and rejects obvious rubbish', () => {
    expect(looksLikeEmail('asha@example.com')).toBe(true)
    expect(looksLikeEmail('asha+tag@sub.example.co.in')).toBe(true)
    expect(looksLikeEmail('not-an-address')).toBe(false)
    expect(looksLikeEmail('')).toBe(false)
    expect(looksLikeEmail('a b@example.com')).toBe(false)
  })
})

describe('LoginAttemptStore', () => {
  const store = (now = () => NOW) => new LoginAttemptStore({ now })

  it('starts every address clean', () => {
    expect(store().get('asha@example.com')).toEqual({ issuedAt: null, attempts: 0, lockedUntil: null })
  })

  it('records an issued code', () => {
    const s = store()
    s.issue('asha@example.com')

    expect(s.get('asha@example.com')).toMatchObject({ issuedAt: NOW, attempts: 0 })
  })

  it('reports a lockout so the request path can refuse too', () => {
    // Without this a script locked out of verifying just asks for a new code and starts again.
    const s = store()
    s.set('asha@example.com', issueState(NOW))
    s.set('asha@example.com', { issuedAt: null, attempts: 0, lockedUntil: NOW + 60_000 })

    expect(s.locked('asha@example.com')).toBe(true)
  })

  it('forgets an address on a successful sign-in', () => {
    const s = store()
    s.issue('asha@example.com')
    s.clear('asha@example.com')

    expect(s.get('asha@example.com').issuedAt).toBeNull()
  })

  it('sweeps stale entries', () => {
    let time = NOW
    const s = new LoginAttemptStore({ now: () => time })
    s.issue('asha@example.com')

    time = NOW + 2 * 60 * 60_000
    s.sweep()

    expect(s.size).toBe(0)
  })

  it('never sweeps a live lockout early', () => {
    // A sweep releasing a lockout would be the cleanup handing out an early parole.
    let time = NOW
    const s = new LoginAttemptStore({ now: () => time })
    s.set('asha@example.com', { issuedAt: null, attempts: 0, lockedUntil: NOW + 3 * 60 * 60_000 })

    time = NOW + 2 * 60 * 60_000
    s.sweep()

    expect(s.locked('asha@example.com')).toBe(true)
  })
})

describe('StubOtpChannel', () => {
  const channel = (log = vi.fn()) => ({ channel: new StubOtpChannel({ log }), log })

  it('sends to a real address and prints the code for the developer', async () => {
    const { channel: otp, log } = channel()

    expect(await otp.send({ address: 'asha@example.com' })).toEqual({ ok: true })
    expect(String(log.mock.calls[0]?.[0])).toContain(STUB_OTP_CODE)
  })

  it('refuses an empty address', async () => {
    const { channel: otp } = channel()

    expect(await otp.send({ address: '   ' })).toMatchObject({ ok: false })
  })

  it('verifies the fixed development code', async () => {
    const { channel: otp } = channel()

    expect(await otp.verify({ address: 'asha@example.com' }, STUB_OTP_CODE)).toBe(true)
  })

  it('rejects anything else', async () => {
    const { channel: otp } = channel()

    for (const code of ['000001', '12345', '0000000', '', 'abcdef', '00000 ']) {
      expect(await otp.verify({ address: 'asha@example.com' }, code)).toBe(false)
    }
  })

  it('rejects a malformed code before comparing it', async () => {
    // A caller submitting a megabyte of digits must not make the comparison itself the attack.
    const { channel: otp } = channel()

    expect(isPlausibleOtp('0'.repeat(100_000))).toBe(false)
    expect(await otp.verify({ address: 'asha@example.com' }, '0'.repeat(100_000))).toBe(false)
  })

  it('has nowhere to return a code to the caller', async () => {
    // The development shortcut that ships to production is unexpressible: `send` yields no code.
    const { channel: otp } = channel()
    const outcome = await otp.send({ address: 'asha@example.com' })

    expect(JSON.stringify(outcome)).not.toContain(STUB_OTP_CODE)
  })
})

describe('OTP factory', () => {
  it('builds the stub in development', () => {
    expect(createOtpChannel({ NODE_ENV: 'development' }).name).toBe('stub')
  })

  it('refuses the stub in production', () => {
    // The sharpest version of this guard in the codebase: a stub reaching production hands every
    // account to anyone who can type six zeroes.
    expect(() => createOtpChannel({ NODE_ENV: 'production' })).toThrow(AuthConfigurationError)
  })

  it('refuses a provider that is not implemented yet rather than downgrading silently', () => {
    expect(() => createOtpChannel({ OTP_PROVIDER: 'resend' })).toThrow(AuthConfigurationError)
  })

  it('refuses a provider it has never heard of', () => {
    expect(() => createOtpChannel({ OTP_PROVIDER: 'carrier-pigeon' })).toThrow(AuthConfigurationError)
  })
})
