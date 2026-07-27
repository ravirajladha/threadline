/**
 * `/checkout` — address, payment method and place order.
 *
 * The route's whole job is to hand `CheckoutView` a server-priced cart and the store's actual
 * rules. Note what it passes and what it does not: the loyalty rules and the COD switch come
 * from `settings`, never from constants in the component, so the owner turning COD off in the
 * admin turns it off here (CLAUDE.md §3 — "anything an admin might ever change is config or DB,
 * never a literal in code").
 *
 * An empty bag renders the component's own empty state rather than redirecting. A redirect races
 * with the customer's own back button, and arriving at `/cart` with no explanation reads as the
 * site having lost their order.
 *
 * The totals shown here are priced **without** a delivery state, because there is not one yet.
 * `/api/checkout` re-prices with the address before writing anything, and `CheckoutView` says so
 * on the page rather than guessing at the difference in the browser.
 */
import type { Metadata } from 'next'

import { CheckoutView } from '@/components/checkout/CheckoutView'
import { getCart, readCartSession } from '@/lib/cart/server'
import { loadPricingSettings } from '@/lib/settings/storeSettings'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
}

export default async function CheckoutPage() {
  const sessionId = await readCartSession()

  const [cart, settings] = await Promise.all([getCart(), loadPricingSettings()])
  const view = await cart.getCart(sessionId ?? '', { create: false })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-fg mb-8 text-3xl font-medium tracking-tight">Checkout</h1>

      <CheckoutView
        cart={view}
        loyaltyRules={settings.loyalty}
        codEnabled={settings.shipping.codEnabled}
        // Loyalty balance and a saved address arrive with real accounts in J8. Until then a
        // checkout is a guest checkout, and the component's defaults are the honest answer.
        loyaltyBalance={0}
      />
    </div>
  )
}
