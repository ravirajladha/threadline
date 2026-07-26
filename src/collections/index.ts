/**
 * Every collection, in the order they appear in the admin sidebar.
 *
 * One import site for `payload.config.ts`, so adding a collection is a single edit and cannot
 * be half-wired — a file in this folder that is missing from this list simply does not exist as
 * far as the database is concerned.
 */
import type { CollectionConfig } from 'payload'

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

export const collections: CollectionConfig[] = [
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
