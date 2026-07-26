/**
 * Every collection, in the order they appear in the admin sidebar.
 *
 * One import site for `payload.config.ts`, so adding a collection is a single edit and cannot
 * be half-wired — a file in this folder that is missing from this list simply does not exist as
 * far as the database is concerned.
 *
 * This is also where each collection is bound to the `Resource` that governs it, which does two
 * jobs: it is the map a reader needs to answer "who can touch this?", and it lets the nav be
 * filtered by role from one place rather than 22 near-identical `hidden` functions. The binding
 * is exhaustive by construction — `RESOURCE_BY_COLLECTION` is typed to require every entry, so
 * a new collection cannot be added without deciding which resource owns it.
 */
import type { CollectionConfig } from 'payload'

import { hiddenUnlessCanRead } from '@/access/adminUI'
import type { Resource } from '@/types'

import { Addresses } from './Addresses'
import { Carts } from './Carts'
import { Categories } from './Categories'
import { ChatSessions } from './ChatSessions'
import { Colours } from './Colours'
import { Coupons } from './Coupons'
import { Customers } from './Customers'
import { LoyaltyTransactions } from './LoyaltyTransactions'
import { Media } from './Media'
import { Notifications } from './Notifications'
import { OrderEvents } from './OrderEvents'
import { OrderItems } from './OrderItems'
import { Orders } from './Orders'
import { Products } from './Products'
import { Returns } from './Returns'
import { Reviews } from './Reviews'
import { SizeCharts } from './SizeCharts'
import { Sizes } from './Sizes'
import { StockMovements } from './StockMovements'
import { Tickets } from './Tickets'
import { Users } from './Users'
import { Variants } from './Variants'
import { Wishlists } from './Wishlists'

/** Sidebar order. Grouped the way an operator thinks, not the way the schema is written. */
const ORDERED: CollectionConfig[] = [
  // Catalog
  Categories,
  Sizes,
  Colours,
  SizeCharts,
  Products,
  Variants,
  StockMovements,
  Media,
  // People
  Users,
  Customers,
  Addresses,
  // Commerce
  Carts,
  Orders,
  OrderItems,
  OrderEvents,
  Coupons,
  Returns,
  LoyaltyTransactions,
  // Engagement
  Reviews,
  Wishlists,
  Tickets,
  ChatSessions,
  Notifications,
]

/**
 * Which resource governs each collection. Must name every collection above — TypeScript will
 * not let a slug be omitted, so this stays honest as the schema grows.
 */
export const RESOURCE_BY_COLLECTION: Record<string, Resource> = {
  categories: 'catalog',
  sizes: 'catalog',
  colours: 'catalog',
  sizeCharts: 'catalog',
  products: 'catalog',
  variants: 'catalog',
  stockMovements: 'catalog',
  media: 'catalog',
  users: 'users',
  customers: 'customers',
  addresses: 'customers',
  wishlists: 'customers',
  carts: 'orders',
  orders: 'orders',
  orderItems: 'orders',
  orderEvents: 'orders',
  loyaltyTransactions: 'orders',
  coupons: 'coupons',
  returns: 'refunds',
  reviews: 'support',
  tickets: 'support',
  chatSessions: 'support',
  notifications: 'support',
}

/**
 * Bind the nav rule without touching each collection file.
 *
 * An explicit `admin.hidden` on a collection wins — a collection that has a reason of its own
 * to stay out of the nav keeps it.
 */
function withRoleAwareNav(collection: CollectionConfig): CollectionConfig {
  const resource = RESOURCE_BY_COLLECTION[collection.slug]
  if (!resource) throw new Error(`Collection "${collection.slug}" has no resource binding.`)

  if (collection.admin?.hidden !== undefined) return collection

  return {
    ...collection,
    admin: { ...collection.admin, hidden: hiddenUnlessCanRead(resource) },
  }
}

export const collections: CollectionConfig[] = ORDERED.map(withRoleAwareNav)
