/**
 * `/account/orders/[number]` — one order.
 *
 * The order number is in the URL and authorises nothing: `accountOrders.find` matches the number
 * **and** the session's customer id in the same query, so a customer pasting a reference from
 * somebody else's confirmation email gets the same `notFound()` as a reference that never existed.
 * That the two are indistinguishable is the point — a 403 would confirm the order is real, and
 * order numbers are a date plus a small daily sequence, which is trivially walked (OWASP A01).
 *
 * The timeline is the `orderEvents` trail, not a story reassembled from timestamp columns, so what
 * the customer reads is what the system actually recorded.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@payload-config'
import { Price } from '@/components/ui/Price'
import { EmptyState } from '@/components/ui/EmptyState'
import { readCustomerSession } from '@/lib/auth/customerSession'
import { createAccountOrders } from '@/lib/orders/accountOrders'
import { isTimelineOpen } from '@/lib/orders/timeline'

export const dynamic = 'force-dynamic'

type Params = Promise<{ number: string }>

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false, follow: false },
}

function formatMoment(iso: string): string {
  const at = new Date(iso)

  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function OrderPage({ params }: { params: Params }) {
  const { number } = await params

  const payload = await getPayload({ config })
  const session = await readCustomerSession(await headers(), payload)

  if (session === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Sign in to see this order"
          description="We check it is you before showing an order."
          action={
            <Link href="/account" className="text-accent text-sm font-medium underline underline-offset-4">
              Sign in
            </Link>
          }
        />
      </div>
    )
  }

  const order = await createAccountOrders({ payload }).find(number, session.user)

  // Not yours and does not exist answer identically.
  if (order === null) notFound()

  const open = isTimelineOpen(order.status)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/account/orders"
          className="text-fg-muted hover:text-fg text-sm transition-colors duration-fast ease-out"
        >
          ← All orders
        </Link>
        <h1 className="text-fg text-2xl font-medium">{order.orderNumber}</h1>
        {order.awbCode ? (
          <p className="text-fg-subtle text-sm">
            {order.courier ?? 'Courier'} · tracking {order.awbCode}
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-fg text-lg font-medium">Progress</h2>
        {order.timeline.length === 0 ? (
          <p className="text-fg-muted text-sm">Nothing recorded yet.</p>
        ) : (
          <ol className="border-border flex flex-col gap-4 border-l pl-5">
            {order.timeline.map((step) => (
              <li key={`${step.status}-${step.at}`} className="relative flex flex-col gap-0.5">
                <span
                  aria-hidden="true"
                  className="bg-accent absolute -left-[1.55rem] top-1.5 size-2 rounded-full"
                />
                <span className="text-fg text-sm font-medium">{step.label}</span>
                {step.detail ? <span className="text-fg-muted text-sm">{step.detail}</span> : null}
                <span className="text-fg-subtle text-xs">{formatMoment(step.at)}</span>
              </li>
            ))}
            {open ? (
              // An open end, so an in-flight order does not read as finished at its last step.
              <li className="relative">
                <span
                  aria-hidden="true"
                  className="border-border bg-surface absolute -left-[1.55rem] top-1.5 size-2 rounded-full border"
                />
                <span className="text-fg-subtle text-sm">Still on its way…</span>
              </li>
            ) : null}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-fg text-lg font-medium">
          {order.itemCount} item{order.itemCount === 1 ? '' : 's'}
        </h2>
        <ul className="border-border divide-border divide-y border-y">
          {order.lines.map((line) => (
            <li key={line.sku} className="flex items-baseline justify-between gap-4 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-fg text-sm font-medium">{line.productTitle}</span>
                <span className="text-fg-muted text-sm">
                  {line.colourName} · {line.sizeLabel}
                </span>
              </div>
              <span className="text-fg-subtle shrink-0 text-sm">× {line.qty}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-fg text-lg font-medium">Total</h2>
        <dl className="flex flex-col gap-1 text-sm">
          {[
            { label: 'Subtotal', value: order.subtotal },
            { label: 'Shipping', value: order.shipping },
            { label: 'Tax', value: order.taxTotal },
            // Only shown when they applied — a row of zeroes reads as a mistake.
            ...(order.discount > 0 ? [{ label: 'Discount', value: -order.discount }] : []),
            ...(order.loyaltyDiscount > 0 ? [{ label: 'Points', value: -order.loyaltyDiscount }] : []),
          ].map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-fg-muted">{row.label}</dt>
              <dd className="text-fg">
                {row.value < 0 ? '−' : ''}
                <Price pricePaise={Math.abs(row.value)} size="sm" />
              </dd>
            </div>
          ))}
          <div className="border-border mt-1 flex justify-between gap-4 border-t pt-2">
            <dt className="text-fg font-medium">Paid</dt>
            <dd>
              <Price pricePaise={order.grandTotal} />
            </dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
