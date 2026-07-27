/**
 * `/cart` — the bag.
 *
 * A thin route by design. It resolves the session, reads the cart through the port and hands the
 * result to `CartView`; every number on the page was priced server-side on this request, and the
 * client component's job is to render it and round-trip changes back to `/api/cart`.
 *
 * Reading the cart deliberately does **not** create one. A visitor who has never added anything
 * has no session cookie, and `getCart('')` returns the empty view without writing a row — so a
 * crawler walking the site cannot fill the `carts` table, and a Server Component never tries the
 * cookie write that Next would refuse anyway (see `lib/cart/server.ts`).
 */
import type { Metadata } from 'next'

import { CartView } from '@/components/cart/CartView'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { getCart, readCartSession } from '@/lib/cart/server'
import type { Crumb } from '@/lib/catalog/types'

/** A cart is per-visitor and always freshly priced; caching it would serve someone else's bag. */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your bag',
  // Nothing here belongs in an index, and a crawler following it would only ever see an empty one.
  robots: { index: false, follow: false },
}

const CRUMBS: Crumb[] = [
  { title: 'Home', href: '/' },
  { title: 'Bag', href: null },
]

export default async function CartPage() {
  const sessionId = await readCartSession()
  const cart = await getCart()
  const view = await cart.getCart(sessionId ?? '', { create: false })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
      <Breadcrumbs crumbs={CRUMBS} />

      <h1 className="text-fg mt-4 mb-8 text-3xl font-medium tracking-tight">Your bag</h1>

      <CartView cart={view} />
    </div>
  )
}
