/**
 * Authenticating a cron request.
 *
 * A scheduled job runs with no user and full authority, so the only thing standing between
 * `/api/cron/abandoned-cart` and the internet is a shared secret. Three rules, and each of them is
 * a way this is usually got wrong:
 *
 * - **No secret configured means refuse everything.** The tempting shortcut — "if `CRON_SECRET` is
 *   unset, skip the check" — turns a missing environment variable into an open endpoint, and it
 *   reads as harmless in a diff.
 * - **Compare in constant time**, and over a *digest* rather than the raw strings, so the
 *   comparison does not depend on the secret's length. `safeCompareHex` refuses a length mismatch
 *   outright, which would otherwise let a caller learn how long the secret is.
 * - **A failure is a 404, not a 401** (CLAUDE.md §2). A 401 confirms the route exists and that
 *   there is a secret worth guessing. That decision belongs to the route; what belongs here is
 *   returning a plain boolean so the route cannot accidentally branch on a reason.
 */
import { createHash } from 'node:crypto'

import { safeCompareHex } from '@/lib/payments/signature'

/** Header a caller may present the secret in, besides `Authorization: Bearer`. */
export const CRON_SECRET_HEADER = 'x-cron-secret'

/** Digest, so two secrets of different lengths still compare in constant time. */
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * The secret a request is presenting, from either accepted form.
 *
 * `Authorization: Bearer <secret>` is what most schedulers send; the header is for a caller that
 * cannot set `Authorization`. Neither is preferred over the other — the first one present is used,
 * so a request cannot try two guesses at once.
 */
export function presentedSecret(headers: Headers): string | null {
  const authorization = headers.get('authorization')

  if (authorization !== null) {
    const [scheme, ...rest] = authorization.trim().split(/\s+/)

    if (scheme?.toLowerCase() === 'bearer') {
      const token = rest.join(' ')

      return token.length > 0 ? token : null
    }
  }

  const header = headers.get(CRON_SECRET_HEADER)

  return header !== null && header.length > 0 ? header : null
}

/** Whether the presented secret is the configured one. False whenever anything is missing. */
export function cronSecretMatches(presented: string | null, expected: string | undefined | null): boolean {
  if (typeof expected !== 'string' || expected.length === 0) return false
  if (presented === null || presented.length === 0) return false

  return safeCompareHex(digest(presented), digest(expected))
}

/** The whole check, against a request. */
export function isAuthorisedCronRequest(headers: Headers, expected: string | undefined | null): boolean {
  return cronSecretMatches(presentedSecret(headers), expected)
}
