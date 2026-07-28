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

/**
 * The things a staff role can hold permission over. Collections map onto one of these
 * rather than each declaring its own bespoke rule — see `src/access/permissions.ts`.
 */
export const RESOURCES = [
  'catalog',
  'orders',
  'refunds',
  'support',
  'coupons',
  'customers',
  'users',
  'settings',
] as const
export type Resource = (typeof RESOURCES)[number]

/** What a role may do with a resource. `full` implies `read`. */
export const PERMISSION_LEVELS = ['none', 'read', 'full'] as const
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

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
export type NotificationChannelName = (typeof NOTIFICATION_CHANNELS)[number]

/**
 * Every message the shop is capable of sending.
 *
 * A closed union rather than a free string, so `notifications.event` cannot drift into three
 * spellings of "order shipped" and a template is guaranteed to exist for each — proved by a test
 * over this list rather than discovered when a customer does not hear from us.
 *
 * The seven order events are named for the *status they announce*, which is what makes
 * `payloadOrders.transition` able to derive one from a transition without a second table.
 */
export const NOTIFICATION_EVENTS = [
  'order.placed',
  'order.confirmed',
  'order.shipped',
  'order.out_for_delivery',
  'order.delivered',
  'order.cancelled',
  'order.refunded',
  'cart.abandoned',
  'stock.back_in_stock',
  'order.review_request',
] as const
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]

export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return typeof value === 'string' && (NOTIFICATION_EVENTS as readonly string[]).includes(value)
}

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

export const TICKET_CATEGORIES = ['order', 'return', 'product', 'payment', 'other'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

/** Who wrote a ticket message. `bot` is the Claude assistant before handoff. */
export const MESSAGE_AUTHOR_TYPES = ['customer', 'agent', 'bot'] as const
export type MessageAuthorType = (typeof MESSAGE_AUTHOR_TYPES)[number]

/** Roles in a stored assistant transcript, mirroring the Claude API. */
export const CHAT_ROLES = ['user', 'assistant'] as const
export type ChatRole = (typeof CHAT_ROLES)[number]

export const LOYALTY_TRANSACTION_TYPES = ['earn', 'redeem', 'expire', 'reverse'] as const
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number]

/** Publication state of a catalog style. Only `active` is sellable. */
export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** Fit feedback drives the "runs small, size up" hint on the product page. */
export const FIT_FEEDBACK = ['runs_small', 'true_to_size', 'runs_large'] as const
export type FitFeedback = (typeof FIT_FEEDBACK)[number]

/** What a coupon applies to. Narrows the cart lines a discount may touch. */
export const COUPON_SCOPES = ['all', 'categories', 'products'] as const
export type CouponScope = (typeof COUPON_SCOPES)[number]

/** GST applies as CGST+SGST within the seller's state, IGST across states. */
export type TaxJurisdiction = 'intra_state' | 'inter_state'
