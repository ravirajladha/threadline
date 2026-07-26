/**
 * Thresholds the admin dashboard reads.
 *
 * Here rather than inline in the component for the reason CLAUDE.md §3 gives: a number an
 * operator would argue about is configuration, not a literal buried in JSX. These two are the
 * borderline case — they change what the dashboard *highlights*, not what the store charges or
 * promises, so they stay in code for now. The moment the owner wants to tune the low-stock
 * threshold themselves, it moves to the `settings` global.
 */
import type { OrderStatus } from '@/types'

/** At or below this many units, an active variant is worth reordering. */
export const LOW_STOCK_THRESHOLD = 5

/**
 * Orders that still need somebody to do something.
 *
 * Deliberately excludes `shipped` and `out_for_delivery` — those are the courier's problem, not
 * the warehouse's — and every terminal status.
 */
export const ACTIONABLE_ORDER_STATUSES: readonly OrderStatus[] = ['pending', 'confirmed', 'packed']
