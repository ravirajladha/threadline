/**
 * `/checkout/pay` — where a prepaid order is settled.
 *
 * Under the stub this renders the local simulator. At J11 the same route becomes the page that
 * opens Razorpay's widget with the intent already stored on the order, which is why the flow
 * redirects here rather than straight to a provider: the checkout endpoint never has to know
 * which gateway is configured, and no user-supplied URL is ever redirected to (OWASP A10).
 *
 * The order comes from the visitor's own cookie. There is no order id in the URL to tamper with.
 *
 * An order that is already paid is not shown a pay button — a refresh after a successful payment
 * would otherwise invite a second one. It goes to the confirmation instead, which is where the
 * customer was heading anyway.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { StubPaymentPanel } from '@/components/checkout/StubPaymentPanel'
import { EmptyState } from '@/components/ui/EmptyState'
import { BagIcon } from '@/components/ui/icons'
import { loadRecentOrder } from '@/lib/orders/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Payment',
  robots: { index: false, follow: false },
}

export default async function PayPage() {
  const order = await loadRecentOrder()

  if (order === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={<BagIcon className="size-10" />}
          title="There is nothing to pay for"
          description="We could not find a recent order for this browser. If you have just paid, check your email for the confirmation."
          action={
            <Link
              href="/shop"
              className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex rounded-control px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out"
            >
              Continue shopping
            </Link>
          }
        />
      </div>
    )
  }

  if (order.paymentStatus === 'paid') redirect('/checkout/success')

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-fg mb-2 text-center text-3xl font-medium tracking-tight">Complete your payment</h1>
      <p className="text-fg-muted mb-8 text-center text-sm">
        Your order is held for you. It is confirmed once payment is received.
      </p>

      <StubPaymentPanel orderNumber={order.orderNumber} amountPaise={order.grandTotalPaise} />
    </div>
  )
}
