/**
 * Cron authentication.
 *
 * A scheduled job runs with no user and full authority, so this check *is* the authentication for
 * `/api/cron/[job]`. The tests below are mostly about the ways it could fail open.
 */
import { describe, expect, it } from 'vitest'

import { CRON_SECRET_HEADER, cronSecretMatches, isAuthorisedCronRequest, presentedSecret } from '@/lib/http/cronAuth'

const SECRET = 'a-long-random-cron-secret'

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

describe('presentedSecret', () => {
  it('reads a bearer token', () => {
    expect(presentedSecret(headers({ authorization: `Bearer ${SECRET}` }))).toBe(SECRET)
  })

  it('accepts any casing of the scheme', () => {
    expect(presentedSecret(headers({ authorization: `bearer ${SECRET}` }))).toBe(SECRET)
  })

  it('reads the header form', () => {
    expect(presentedSecret(headers({ [CRON_SECRET_HEADER]: SECRET }))).toBe(SECRET)
  })

  it('ignores a non-bearer authorization scheme', () => {
    expect(presentedSecret(headers({ authorization: `Basic ${SECRET}` }))).toBeNull()
  })

  it('prefers the bearer token and does not fall through to the header', () => {
    // A fallback chain would let a caller present two guesses in one request.
    expect(
      presentedSecret(headers({ authorization: 'Bearer wrong', [CRON_SECRET_HEADER]: SECRET })),
    ).toBe('wrong')
  })

  it('is null when nothing is presented', () => {
    expect(presentedSecret(headers({}))).toBeNull()
    expect(presentedSecret(headers({ authorization: 'Bearer ' }))).toBeNull()
  })
})

describe('cronSecretMatches', () => {
  it('accepts the configured secret', () => {
    expect(cronSecretMatches(SECRET, SECRET)).toBe(true)
  })

  it('rejects a wrong secret', () => {
    expect(cronSecretMatches('wrong', SECRET)).toBe(false)
  })

  it('rejects everything when no secret is configured', () => {
    // The failure mode this whole module exists to prevent: an unset environment variable turning
    // a scheduled-job endpoint into an open one.
    expect(cronSecretMatches(SECRET, undefined)).toBe(false)
    expect(cronSecretMatches(SECRET, '')).toBe(false)
    expect(cronSecretMatches(null, undefined)).toBe(false)
  })

  it('rejects an absent presented secret', () => {
    expect(cronSecretMatches(null, SECRET)).toBe(false)
    expect(cronSecretMatches('', SECRET)).toBe(false)
  })

  it('compares secrets of different lengths without refusing on length alone', () => {
    // Digested first, so the comparison is over two equal-length hex strings and cannot leak how
    // long the real secret is.
    expect(cronSecretMatches('short', SECRET)).toBe(false)
    expect(cronSecretMatches(`${SECRET}x`, SECRET)).toBe(false)
  })

  it('is exact — no trimming, no case folding', () => {
    expect(cronSecretMatches(` ${SECRET}`, SECRET)).toBe(false)
    expect(cronSecretMatches(SECRET.toUpperCase(), SECRET)).toBe(false)
  })
})

describe('isAuthorisedCronRequest', () => {
  it('authorises a correctly presented secret', () => {
    expect(isAuthorisedCronRequest(headers({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true)
  })

  it('refuses a request with no credentials', () => {
    expect(isAuthorisedCronRequest(headers({}), SECRET)).toBe(false)
  })
})
