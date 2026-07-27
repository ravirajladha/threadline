/**
 * `/checkout/failed` — payment did not go through.
 *
 * Worth having as a real page rather than a query flag on the confirmation. A failed payment has
 * a different job to do: reassure the customer that nothing was charged, say what happened to
 * their items, and offer one obvious way forward.
 *
 * The stock reservation has already been released by the webhook handler at this point, so the
 * page does not promise the items are still held — it says plainly that they have gone back, and
 * points at the bag rather than at a retry that might now fail on availability.
 */
import type { Metadata } from 'next'
import Link from 'next/link'

import { loadRecentOrder } from '@/lib/orders/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Payment unsuccessful',
  robots: { index: false, follow: false },
}

export default async function CheckoutFailedPage() {
  const order = await loadRecentOrder()

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-fg text-3xl font-medium tracking-tight">Payment unsuccessful</h1>

      <p className="text-fg-muted mt-4 text-sm">
        {order === null
          ? 'Your payment did not go through, and nothing has been charged.'
          : `Payment for order ${order.orderNumber} did not go through. Nothing has been charged.`}
      </p>

      <p className="text-fg-subtle mt-2 text-sm">
        The items have been released back into stock, so please check your bag before trying again.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/cart"
          className="bg-accent text-accent-fg hover:bg-accent-hover rounded-control px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out"
        >
          Back to your bag
        </Link>
        <Link
          href="/shop"
          className="border-border-strong text-fg hover:bg-surface rounded-control border px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out"
        >
          Keep shopping
        </Link>
      </div>
    </div>
  )
}
