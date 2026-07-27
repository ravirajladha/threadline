/**
 * The same guarantees `endpoints/guards.ts` gives Payload endpoints, for App Router handlers.
 *
 * Two different runtimes — a `PayloadHandler` receives a `PayloadRequest`, a route handler
 * receives a web `Request` — so the helpers cannot literally be shared, but the rules they
 * enforce are identical and are stated once here:
 *
 * - An unanticipated throw becomes a plain 500. A database error must never return the failing
 *   SQL and a stack trace to a customer (OWASP A05).
 * - A body is narrowed before it is used. Something arriving over the wire is input, not data.
 * - Public mutations are rate-limited (OWASP A07).
 *
 * These routes are the storefront's *public* surface, so unlike the admin endpoints there is no
 * role to check — the authority is the session cookie, and every handler still has to prove that
 * whatever it touches belongs to that session.
 */
import { RateLimiter, RATE_LIMITS, clientKey, type RateLimitRule } from './rateLimit'

/** JSON with the right content type, and `no-store` so a cart is never cached by a proxy. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })
}

/** The message a customer sees when something we did not anticipate broke. */
export const GENERIC_ERROR = 'Something went wrong. Please try again.'

/**
 * Wrap a route handler in the error boundary.
 *
 * Only the unanticipated is caught. An expected failure — an unknown variant, a coupon that does
 * not apply — is returned by the handler itself as a 400 with a sentence written for a human.
 */
export function safeRoute<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    try {
      return await handler(request, ...args)
    } catch (error) {
      // `console.error` rather than Payload's logger: this boundary has to hold even when the
      // failure was Payload failing to initialise, and reaching for the logger to report that
      // would throw a second time inside the catch.
      console.error(`Unhandled error in ${request.method} ${new URL(request.url).pathname}`, error)

      return json({ error: GENERIC_ERROR }, 500)
    }
  }
}

/**
 * One limiter for the process.
 *
 * Module scope, so the counters survive between requests — a limiter constructed per request
 * counts to one and permits everything, which looks like it is working right up until it matters.
 */
const limiter = new RateLimiter()

/**
 * Refuse if the caller is over the limit.
 *
 * Returns a `Response` to send or `null` to proceed, so a handler reads as
 * `const limited = enforceRateLimit(request, 'cartMutation'); if (limited) return limited`.
 */
export function enforceRateLimit(
  request: Request,
  name: keyof typeof RATE_LIMITS,
  rule: RateLimitRule = RATE_LIMITS[name],
): Response | null {
  const decision = limiter.check(clientKey(request.headers, name), rule)

  // Cheap opportunistic housekeeping — the alternative is a timer that keeps the process alive.
  if (Math.random() < 0.01) limiter.sweep(rule.windowMs)

  if (decision.ok) return null

  return json({ error: 'Too many requests. Please slow down and try again shortly.' }, 429, {
    'Retry-After': String(decision.retryAfterSeconds),
  })
}

/** Read a JSON body, or null if it is absent or not an object. Never throws. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()

    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Narrow an unknown field to a record id. Mirrors `toId` in the endpoint guards. */
export function toId(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()

  return null
}

/**
 * Narrow an unknown field to a quantity.
 *
 * Bounded rather than merely non-negative: the cart clamps to availability anyway, but letting
 * `Number.MAX_SAFE_INTEGER` through means the clamp is done *after* a query has been built
 * around it.
 */
export function toQty(value: unknown, max: number): number | null {
  // Deliberately not `Number(value)`. That coerces `null`, `''`, `[]` and `false` to **zero**,
  // and zero is a meaningful quantity here — the cart reads it as "remove this line". A missing
  // `qty` field would therefore delete the customer's line instead of being refused as a bad
  // request. Only a real number, or a string that is entirely a number, is accepted.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null

    return Math.min(Math.max(0, Math.floor(value)), max)
  }

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null

  return Math.min(Math.max(0, Math.floor(parsed)), max)
}
