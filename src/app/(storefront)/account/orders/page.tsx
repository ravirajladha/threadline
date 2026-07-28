/**
 * `/account/orders` — order history.
 *
 * Scoped by the session in the query, so another customer's order is never fetched. Signed out is a
 * real page rather than a redirect, matching `/account/requests` — and now the link goes somewhere,
 * because J8 built the login it points at.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { getPayload } from 'payload'

import config from '@payload-config'
import { Price } from '@/components/ui/Price'
import { EmptyState } from '@/components/ui/EmptyState'
import { BagIcon } from '@/components/ui/icons'
import { readCustomerSession } from '@/lib/auth/customerSession'
import { createAccountOrders } from '@/lib/orders/accountOrders'
import { TIMELINE_LABELS } from '@/lib/orders/timeline'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
}

function formatDate(iso: string | null): string {
  if (iso === null) return ''
  const at = new Date(iso)

  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

export default async function OrdersPage() {
  const payload = await getPayload({ config })
  const session = await readCustomerSession(await headers(), payload)

  if (session === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Sign in to see your orders"
          description="Your order history lives with your account."
          action={
            <Link href="/account" className="text-accent text-sm font-medium underline underline-offset-4">
              Sign in
            </Link>
          }
        />
      </div>
    )
  }

  const orders = await createAccountOrders({ payload }).list(session.user)

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-fg text-2xl font-medium">Your orders</h1>

      {orders.length === 0 ? (
        <EmptyState
          icon={<BagIcon className="size-10" />}
          title="No orders yet"
          description="When you buy something, it will appear here with its progress."
          action={
            <Link href="/shop" className="text-accent text-sm font-medium underline underline-offset-4">
              Start shopping
            </Link>
          }
        />
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {orders.map((order) => (
            <li key={order.orderNumber}>
              <Link
                href={`/account/orders/${order.orderNumber}`}
                className="border-border hover:bg-surface-raised flex flex-col gap-1 rounded-card border p-4 transition-colors duration-fast ease-out"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-fg font-medium">{order.orderNumber}</span>
                  <Price pricePaise={order.grandTotal} size="sm" />
                </div>
                <div className="text-fg-muted flex flex-wrap gap-x-2 gap-y-1 text-sm">
                  {/* The same labels the detail timeline uses, so a status never has two names. */}
                  <span>{TIMELINE_LABELS[order.status]?.label ?? order.status.replace(/_/g, ' ')}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {order.itemCount} item{order.itemCount === 1 ? '' : 's'}
                  </span>
                  {order.placedAt ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatDate(order.placedAt)}</span>
                    </>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
