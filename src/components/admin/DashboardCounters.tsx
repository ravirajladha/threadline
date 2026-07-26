import type { ServerProps } from 'payload'

import { canRead, staffRoleOf } from '@/access'
import { LOW_STOCK_THRESHOLD, ACTIONABLE_ORDER_STATUSES } from '@/lib/admin/dashboard'

/**
 * The counters above the admin dashboard.
 *
 * A dashboard that greets the owner with "welcome" tells them nothing. These four numbers are
 * the ones that mean somebody has to do something today: stock about to run out, orders not yet
 * moving, customers waiting on a reply, reviews waiting on moderation.
 *
 * A Server Component, so the counts are queried on the server and no data reaches the browser
 * beyond the four numbers themselves. Each counter is gated on the same matrix the access rules
 * use — a `marketing` user sees the catalog and order counts and nothing about support.
 */

interface Counter {
  label: string
  value: number
  href: string
  hint: string
}

export async function DashboardCounters({ payload, user }: ServerProps): Promise<React.ReactElement | null> {
  if (!payload) return null

  const role = staffRoleOf(user)
  if (role === null) return null

  const counters: Counter[] = []

  if (canRead(role, 'catalog')) {
    const lowStock = await payload.count({
      collection: 'variants',
      where: {
        and: [{ isActive: { equals: true } }, { stockQty: { less_than_equal: LOW_STOCK_THRESHOLD } }],
      },
      overrideAccess: true,
    })

    counters.push({
      label: 'Low stock',
      value: lowStock.totalDocs,
      href: `/admin/collections/variants?where[stockQty][less_than_equal]=${LOW_STOCK_THRESHOLD}`,
      hint: `Active variants at or below ${LOW_STOCK_THRESHOLD} units`,
    })
  }

  if (canRead(role, 'orders')) {
    const awaiting = await payload.count({
      collection: 'orders',
      where: { status: { in: [...ACTIONABLE_ORDER_STATUSES] } },
      overrideAccess: true,
    })

    counters.push({
      label: 'Orders to action',
      value: awaiting.totalDocs,
      href: '/admin/collections/orders',
      hint: 'Placed but not yet shipped',
    })
  }

  if (canRead(role, 'support')) {
    const [openTickets, pendingReviews] = await Promise.all([
      payload.count({
        collection: 'tickets',
        where: { status: { in: ['open', 'pending_customer'] } },
        overrideAccess: true,
      }),
      payload.count({
        collection: 'reviews',
        where: { status: { equals: 'pending' } },
        overrideAccess: true,
      }),
    ])

    counters.push(
      {
        label: 'Open tickets',
        value: openTickets.totalDocs,
        href: '/admin/collections/tickets',
        hint: 'Customers waiting on a reply',
      },
      {
        label: 'Reviews to moderate',
        value: pendingReviews.totalDocs,
        href: '/admin/collections/reviews',
        hint: 'Not yet visible on the storefront',
      },
    )
  }

  if (counters.length === 0) return null

  return (
    <div className="threadline-counters">
      {counters.map((counter) => (
        <a className="threadline-counter" href={counter.href} key={counter.label}>
          <span className="threadline-counter__value">{counter.value}</span>
          <span className="threadline-counter__label">{counter.label}</span>
          <span className="threadline-counter__hint">{counter.hint}</span>
        </a>
      ))}
    </div>
  )
}

export default DashboardCounters
