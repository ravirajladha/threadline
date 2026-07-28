/**
 * `/api/auth` — request a code, verify it, sign out.
 *
 * The security properties, in the order they matter:
 *
 * - **The same answer whether or not the account exists** (OWASP A07). `request` replies "if that
 *   address has an account, a code is on its way" every time, and does the same work either way, so
 *   neither the body nor the timing turns this form into a customer-list oracle. The account is
 *   created lazily on first *successful* verification, never on request — otherwise probing
 *   addresses would populate the customers table for us.
 * - **Bounded twice.** A sliding-window rate limit per caller (`http/rateLimit.ts`) and a per-address
 *   attempt counter with a lockout (`auth/login.ts`). Neither replaces the other: the limiter stops
 *   one script hammering the endpoint, the lockout stops a distributed one grinding a single
 *   address. The lockout is checked on *request* as well as verify, or a locked-out attacker just
 *   asks for a fresh code and starts over.
 * - **The code never appears in a response.** `OtpChannel.send` has nowhere to put one, so the
 *   development shortcut that ships to production is unexpressible. In development it is printed to
 *   the server console.
 * - **The session cookie is Payload's**, minted with Payload's own claims and flags — httpOnly, so
 *   no script can read it (A02). See `auth/session.ts`.
 */
import { getPayload } from 'payload'

import config from '@payload-config'
import { CUSTOMER_COLLECTION } from '@/access'
import { loginAttempts } from '@/lib/auth/attemptStore'
import { getOtpChannel } from '@/lib/auth/factory'
import {
  decideLogin,
  describeLoginRefusal,
  looksLikeEmail,
  normaliseLoginAddress,
} from '@/lib/auth/login'
import { expireCustomerSessionCookie, issueCustomerSessionCookie } from '@/lib/auth/session'
import { getCart, readCartSession } from '@/lib/cart/server'
import { enforceRateLimit, json, readJsonBody, safeRoute } from '@/lib/http/route'
import type { Customer } from '@/payload-types'

export const dynamic = 'force-dynamic'

/** The one answer to a code request, whatever the truth is. */
const CODE_SENT = {
  ok: true,
  message: 'If that address has an account, a code is on its way.',
} as const

/** Find the customer for an address, or null. Never creates. */
async function findCustomer(payload: Awaited<ReturnType<typeof getPayload>>, email: string) {
  const { docs } = await payload.find({
    collection: CUSTOMER_COLLECTION,
    where: { email: { equals: email } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
  })

  return (docs[0] as Customer | undefined) ?? null
}

export const POST = safeRoute(async (request: Request): Promise<Response> => {
  const body = await readJsonBody(request)
  if (body === null) return json({ error: 'Expected a JSON body.' }, 400)

  const action = typeof body.action === 'string' ? body.action : ''
  const payload = await getPayload({ config })

  // --- sign out -------------------------------------------------------------
  if (action === 'logout') {
    // No rate limit and no session check: signing out an already-signed-out visitor is harmless,
    // and refusing it would leave a stale cookie in place on the one path meant to clear it.
    return json({ ok: true }, 200, { 'Set-Cookie': expireCustomerSessionCookie(payload) })
  }

  if (action !== 'request' && action !== 'verify') {
    return json({ error: 'action must be one of: request, verify, logout.' }, 400)
  }

  const limited = enforceRateLimit(request, action === 'request' ? 'authRequest' : 'authVerify')
  if (limited) return limited

  const email = normaliseLoginAddress(body.email)

  // Shape-checked before anything else, so a malformed address costs one regex rather than a
  // database round trip — and so the answer to "is this even an address" never depends on the
  // account existing.
  if (!looksLikeEmail(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400)
  }

  // --- request a code -------------------------------------------------------
  if (action === 'request') {
    // Refused here as well as on verify: otherwise the lockout is a pause, not a limit.
    if (loginAttempts.locked(email)) {
      return json(CODE_SENT)
    }

    const customer = await findCustomer(payload, email)

    // The work is the same either way — the code is only actually dispatched for a real account,
    // but the response and the timing profile do not distinguish the two.
    if (customer !== null) {
      const outcome = await getOtpChannel().send({ address: email })

      if (outcome.ok) loginAttempts.issue(email)
      // A failure is logged, not surfaced. Telling the caller "we could not send to that address"
      // is an enumeration signal by another name.
      else payload.logger.warn({ channel: getOtpChannel().name }, 'Sign-in code could not be sent')
    } else {
      // No account. Nothing is created and nothing is sent; the reply below is identical.
      payload.logger.info({ known: false }, 'Sign-in code requested')
    }

    return json(CODE_SENT)
  }

  // --- verify ---------------------------------------------------------------
  const code = typeof body.code === 'string' ? body.code : ''
  const state = loginAttempts.get(email)

  const customer = await findCustomer(payload, email)

  // Verified against the channel before the account is consulted, so a guess costs the same whether
  // or not the address is real.
  const codeMatches = customer !== null && (await getOtpChannel().verify({ address: email }, code))

  const decision = decideLogin({ state, codeMatches, now: Date.now() })

  if (!decision.ok) {
    loginAttempts.set(email, decision.nextState)

    payload.logger.warn(
      // Reason and outcome, never the address or the code (OWASP A09).
      { reason: decision.refusal.reason },
      'Sign-in verification refused',
    )

    return json({ error: describeLoginRefusal(decision.refusal) }, 401)
  }

  // Unreachable when `codeMatches` is true — kept because the compiler cannot see that, and a
  // non-null assertion here would be exactly the kind of shortcut this route exists to avoid.
  if (customer === null) return json({ error: describeLoginRefusal({ reason: 'invalid_code' }) }, 401)

  loginAttempts.clear(email)

  const cookie = await issueCustomerSessionCookie(payload, customer)

  // The guest cart becomes theirs. Quantities sum and then clamp to what is actually available —
  // `cart/merge.ts`, built and tested in J4, so this is wiring rather than new logic.
  //
  // Wrapped: a merge failure must not undo a valid sign-in. The customer would be left holding a
  // rejected login for a cart problem, and the cart is recoverable while the session is not.
  const sessionId = await readCartSession()

  if (sessionId !== null) {
    try {
      await (await getCart()).mergeGuestCart(sessionId, customer.id)
    } catch (error) {
      payload.logger.error({ err: error, customer: customer.id }, 'Guest cart merge failed on sign-in')
    }
  }

  payload.logger.info({ customer: customer.id }, 'Customer signed in')

  return json({ ok: true, name: customer.name }, 200, { 'Set-Cookie': cookie })
})
