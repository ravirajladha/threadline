/**
 * Reading back the order a visitor has just placed.
 *
 * Three routes need this — the pay screen, the confirmation and the failure page — and each of
 * them needs exactly the same guarantee: **the order shown is the one in this visitor's own
 * cookie**, never one named in the URL. Writing that check three times is writing it twice too
 * many, so it lives here and the pages call `loadRecentOrder()`.
 *
 * The view returned is flattened to plain data on purpose. It crosses into client components, and
 * handing a raw Payload document to the browser would ship the whole row — including fields a
 * customer has no business seeing — into the page's serialised props.
 */
import { cache } from 'react'
import { getPayload } from 'payload'
import type { Where } from 'payload'

import config from '@payload-config'
import type { OrderStatus, PaymentStatus } from '@/types'
import { readRecentOrder } from './recentOrder'

/** One line of a placed order, as the confirmation page shows it. */
export interface RecentOrderLine {
  id: number | string
  productTitle: string
  sizeLabel: string
  colourName: string
  qty: number
  lineTotalPaise: number
}

export interface RecentOrderView {
  id: number | string
  orderNumber: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod: string
  email: string
  grandTotalPaise: number
  placedAt: string | null
  /** Enough to say where it is going, without reprinting the full address on a shared screen. */
  deliverTo: { name: string; city: string; pincode: string } | null
  lines: RecentOrderLine[]
}

function money(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The visitor's most recent order, or null.
 *
 * `cache`d per request so a page that reads it for its metadata and again for its body issues one
 * query, not two.
 */
export const loadRecentOrder = cache(async (): Promise<RecentOrderView | null> => {
  const orderNumber = await readRecentOrder()
  if (orderNumber === null) return null

  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } } satisfies Where,
    depth: 0,
    limit: 1,
    pagination: false,
    // Access is already decided — by the httpOnly cookie, above. Until J8 there is no customer
    // session for Payload's own access rules to check against, so overriding here and scoping by
    // the cookie is the honest expression of the rule rather than a way around it.
    overrideAccess: true,
  })

  const order = docs[0]
  if (order === undefined) return null

  const { docs: items } = await payload.find({
    collection: 'orderItems',
    where: { order: { equals: order.id } } satisfies Where,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const address = order.shippingAddress as
    | { name?: unknown; city?: unknown; pincode?: unknown }
    | null
    | undefined

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status as OrderStatus,
    paymentStatus: order.paymentStatus as PaymentStatus,
    paymentMethod: text(order.paymentMethod),
    email: text(order.email),
    grandTotalPaise: money(order.grandTotal),
    placedAt: typeof order.placedAt === 'string' ? order.placedAt : null,
    deliverTo:
      address == null
        ? null
        : {
            name: text(address.name),
            city: text(address.city),
            pincode: text(address.pincode),
          },
    lines: items.map((item) => ({
      id: item.id,
      productTitle: text(item.productTitle),
      sizeLabel: text(item.sizeLabel),
      colourName: text(item.colourName),
      qty: typeof item.qty === 'number' ? item.qty : 0,
      lineTotalPaise: money(item.lineTotal),
    })),
  }
})
