/**
 * `/checkout/success` — the confirmation.
 *
 * Reads the order from the visitor's own cookie, never from the URL, so counting upwards through
 * order numbers reveals nothing (OWASP A01 — see `lib/orders/recentOrder.ts` for why that matters
 * before J8 brings real accounts).
 *
 * The page states the payment status rather than assuming success. Arriving here is not proof of
 * payment — only a signature-verified webhook is — and for a prepaid order that webhook may not
 * have landed yet. Saying "we are confirming your payment" and being right is better than saying
 * "paid" and being wrong, and it is the same sentence a real gateway's race will need.
 */
import type { Metadata } from 'next'
import Link from 'next/link'

import { Price } from '@/components/ui/Price'
import { EmptyState } from '@/components/ui/EmptyState'
import { BagIcon } from '@/components/ui/icons'
import { loadRecentOrder } from '@/lib/orders/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Order confirmed',
  robots: { index: false, follow: false },
}

/** What to tell the customer about money, given where the order actually is. */
function paymentLine(paymentStatus: string, paymentMethod: string): string {
  if (paymentMethod === 'cod') return 'You will pay in cash when your order is delivered.'
  if (paymentStatus === 'paid') return 'Payment received. Your order is confirmed.'
  if (paymentStatus === 'failed') return 'Payment did not go through. Nothing has been charged.'

  return 'We are confirming your payment. This page will show the final status once it clears.'
}

export default async function CheckoutSuccessPage() {
  const order = await loadRecentOrder()

  if (order === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={<BagIcon className="size-10" />}
          title="No recent order"
          description="We could not find a recent order for this browser. If you have just ordered, your confirmation email has the details."
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="mb-10 text-center">
        <p className="text-accent mb-2 text-sm font-medium tracking-[0.2em] uppercase">Thank you</p>
        <h1 className="text-fg text-3xl font-medium tracking-tight">Your order is placed</h1>
        <p className="text-fg-muted mt-3 text-sm">
          Order <span className="text-fg font-medium">{order.orderNumber}</span> — a confirmation is on
          its way to {order.email}.
        </p>
      </div>

      <div className="border-border rounded-card border p-6">
        <p className="text-fg-muted mb-6 text-sm">{paymentLine(order.paymentStatus, order.paymentMethod)}</p>

        <ul className="divide-border flex flex-col divide-y">
          {order.lines.map((line) => (
            <li key={String(line.id)} className="flex items-baseline justify-between gap-4 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="text-fg truncate text-sm font-medium">{line.productTitle}</p>
                <p className="text-fg-subtle text-xs">
                  {line.colourName} · {line.sizeLabel} · Qty {line.qty}
                </p>
              </div>
              <Price pricePaise={line.lineTotalPaise} size="sm" />
            </li>
          ))}
        </ul>

        <div className="border-border mt-4 flex items-baseline justify-between border-t pt-4">
          <span className="text-fg text-base font-medium">Total</span>
          <Price pricePaise={order.grandTotalPaise} size="lg" />
        </div>

        {order.deliverTo !== null ? (
          <p className="text-fg-muted mt-6 text-sm">
            Delivering to {order.deliverTo.name}, {order.deliverTo.city} {order.deliverTo.pincode}.
          </p>
        ) : null}
      </div>

      <div className="mt-8 text-center">
        <Link
          href="/shop"
          className="text-fg-muted hover:text-fg text-sm transition-colors duration-fast ease-out"
        >
          Continue shopping
        </Link>
      </div>
    </div>
  )
}
