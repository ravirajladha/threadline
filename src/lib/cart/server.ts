/**
 * The storefront's one entry point to cart data.
 *
 * Mirrors `catalog/server.ts`: routes ask for a `CartPort` and never construct a Payload client
 * themselves, so the dependency points at the interface and a page can later be rendered against
 * a fixture by changing this file alone.
 *
 * The session handling is the part with a real constraint behind it. **A Server Component cannot
 * set a cookie** — by the time a page renders, Next has already begun streaming and the headers
 * are gone — so there are deliberately two ways to get a session id:
 *
 * - `readCartSession()` reads the cookie and returns null if there is none. Safe during render.
 *   A visitor with no cart sees an empty one; no row is created, which also means a crawler
 *   cannot fill the `carts` table simply by walking the site.
 * - `ensureCartSession()` reads or mints one and writes the cookie. Only legal in a Route Handler
 *   or a Server Action, which is exactly where a cart is first created — the moment something is
 *   added to it.
 *
 * Splitting them is what stops the cart page from silently issuing a cookie during a streamed
 * render, which fails at runtime rather than at compile time and only on some paths.
 */
import { cache } from 'react'
import { cookies } from 'next/headers'
import { getPayload } from 'payload'

import config from '@payload-config'
import { loadPricingSettings } from '@/lib/settings/storeSettings'
import { createPayloadCartPort } from './payloadCart'
import { CART_COOKIE, cartCookieOptions, isValidSessionId, newSessionId } from './session'
import type { CartPort } from './types'

export const getCart = cache(async (): Promise<CartPort> => {
  const payload = await getPayload({ config })
  // Resolved once per request and handed in, so a cart mutation that re-prices three times does
  // not read the `settings` global three times.
  const settings = await loadPricingSettings(payload)

  return createPayloadCartPort({ payload, settings })
})

/**
 * The session id on this request, or null.
 *
 * A malformed cookie is treated as absent rather than as an error: it is almost always a stale
 * value from an earlier version of the site, and the correct response to that is an empty cart,
 * not a 500.
 */
export async function readCartSession(): Promise<string | null> {
  const store = await cookies()
  const value = store.get(CART_COOKIE)?.value

  return isValidSessionId(value) ? value : null
}

/**
 * The session id, minting and setting one if this visitor has none.
 *
 * Route handlers and Server Actions only — see the note at the top of this file.
 */
export async function ensureCartSession(): Promise<string> {
  const store = await cookies()
  const existing = store.get(CART_COOKIE)?.value

  if (isValidSessionId(existing)) return existing

  const sessionId = newSessionId()
  store.set(CART_COOKIE, sessionId, cartCookieOptions())

  return sessionId
}
