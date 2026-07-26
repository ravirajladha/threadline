/**
 * Shared domain types.
 *
 * These mirror `docs/SCHEMA.md`. Nothing in the codebase may use a bare string where
 * one of these unions applies — see CLAUDE.md §2 "No magic strings".
 */

/** Staff roles. Permissions per role are defined in `src/access`. */
export const STAFF_ROLES = [
  'super_admin',
  'catalog_manager',
  'order_manager',
  'support_agent',
  'marketing',
] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

/** Which size set a category uses. Must match the `sizes.group` values. */
export const SIZE_GROUPS = ['topwear', 'bottomwear', 'kids', 'footwear', 'free'] as const
export type SizeGroup = (typeof SIZE_GROUPS)[number]

/** Order lifecycle. Legal transitions are enforced in `src/lib/orders`. */
export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'rto',
  'payment_failed',
  'returned',
  'refunded',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const PAYMENT_METHODS = ['razorpay', 'cod'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** Append-only stock ledger entry types. */
export const STOCK_MOVEMENT_TYPES = ['in', 'out', 'adjust', 'return', 'damage'] as const
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number]

export const NOTIFICATION_CHANNELS = ['email', 'whatsapp'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const NOTIFICATION_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'failed',
  'read',
] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

export const COUPON_TYPES = ['percent', 'flat', 'free_shipping'] as const
export type CouponType = (typeof COUPON_TYPES)[number]

export const RETURN_TYPES = ['return', 'exchange'] as const
export type ReturnType = (typeof RETURN_TYPES)[number]

export const RETURN_STATUSES = [
  'requested',
  'approved',
  'picked_up',
  'received',
  'refunded',
  'rejected',
  'exchange_shipped',
] as const
export type ReturnStatus = (typeof RETURN_STATUSES)[number]

export const TICKET_STATUSES = ['open', 'pending_customer', 'resolved', 'closed'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const LOYALTY_TRANSACTION_TYPES = ['earn', 'redeem', 'expire', 'reverse'] as const
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number]

/** GST applies as CGST+SGST within the seller's state, IGST across states. */
export type TaxJurisdiction = 'intra_state' | 'inter_state'
