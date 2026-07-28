/**
 * The ticket status machine.
 *
 * Smaller than the order machine and built on the same principle: a status is not a free-text field
 * that anything may set. Statuses arrive from an agent clicking a button, a customer replying, and
 * a scheduled sweep that closes stale threads — three uncoordinated sources, which is exactly the
 * situation where "just assign it" produces a resolved ticket the customer is still writing into.
 *
 * The graph, and the judgement in it:
 *
 * - `open ⇄ pending_customer` in both directions, because a thread genuinely does bounce.
 * - `resolved → open` is legal: a customer replying to a resolved ticket has *not* been helped, and
 *   the alternative is a second ticket with none of the history.
 * - `closed` is terminal. Reopening a closed thread would let a months-old ticket resurface with a
 *   stale agent assignment and an order that has long since been refunded; a new ticket, which can
 *   reference the old one, is the honest answer.
 */
import { TICKET_STATUSES, type TicketStatus } from '@/types'

export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> =
  Object.freeze({
    open: ['pending_customer', 'resolved', 'closed'],
    pending_customer: ['open', 'resolved', 'closed'],
    // Reopened by a customer who is not satisfied, or closed once nobody comes back.
    resolved: ['open', 'closed'],
    closed: [],
  })

export const TERMINAL_TICKET_STATUSES: readonly TicketStatus[] = Object.freeze(
  TICKET_STATUSES.filter((status) => TICKET_TRANSITIONS[status].length === 0),
)

export class IllegalTicketTransitionError extends Error {
  readonly from: TicketStatus
  readonly to: TicketStatus

  constructor(from: TicketStatus, to: TicketStatus) {
    super(`A ticket cannot move from ${from} to ${to}`)
    this.name = 'IllegalTicketTransitionError'
    this.from = from
    this.to = to
  }
}

export function isTerminalTicketStatus(status: TicketStatus): boolean {
  return TICKET_TRANSITIONS[status].length === 0
}

/**
 * Whether a transition is legal.
 *
 * A move to the same status is **not** legal, for the same reason it is not on an order: it looks
 * harmless and it is how a double-clicked button writes a second "resolved" and fires a second
 * resolution email.
 */
export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to)
}

export function assertTicketTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransitionTicket(from, to)) throw new IllegalTicketTransitionError(from, to)
}
