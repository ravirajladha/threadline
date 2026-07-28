/**
 * Ticket documents → flat, serialisable view models.
 *
 * The same job `catalog/variantView.ts` does, for the same reasons: a Server Component may only
 * hand plain data to a Client Component, and a page that reads Payload documents directly ends up
 * with formatting decisions scattered through JSX.
 *
 * What is *not* here matters as much. A view model carries the thread and its statuses; it does not
 * carry the customer's id, the assigned agent, or the agent's name — none of which a customer's
 * page needs, and every field a view model omits is a field that cannot leak through it.
 */
import type { Ticket } from '@/payload-types'
import type { MessageAuthorType, TicketStatus } from '@/types'

export interface TicketMessageView {
  author: string
  authorType: MessageAuthorType
  /** Plain text. Rendered as text — never as HTML (OWASP A03). */
  body: string
  sentAt: string
  /** Whether to show it on the customer's side of the thread. */
  fromCustomer: boolean
}

export interface TicketView {
  ticketNumber: string
  subject: string
  status: TicketStatus
  category: string
  createdAt: string
  /** True when the thread accepts no further messages, so the reply box is not offered. */
  closed: boolean
  messages: TicketMessageView[]
  /** Preview for the list — the latest message, trimmed to a line. */
  latest: string | null
}

/** How long a list preview may run before it is cut. */
const PREVIEW_LENGTH = 120

function preview(body: string): string {
  const single = body.replace(/\s+/g, ' ').trim()

  return single.length <= PREVIEW_LENGTH ? single : `${single.slice(0, PREVIEW_LENGTH - 1)}…`
}

/** Staff-facing label for a status. Used on both surfaces, so the customer sees the same words. */
export const TICKET_STATUS_LABELS: Readonly<Record<TicketStatus, string>> = Object.freeze({
  open: 'Open',
  pending_customer: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
})

export function toTicketView(ticket: Ticket): TicketView {
  const messages = (ticket.messages ?? []).map((message) => ({
    author: message.author,
    authorType: message.authorType,
    body: message.body,
    sentAt: typeof message.sentAt === 'string' ? message.sentAt : '',
    fromCustomer: message.authorType === 'customer',
  }))

  const last = messages[messages.length - 1]

  return {
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status,
    category: ticket.category,
    createdAt: typeof ticket.createdAt === 'string' ? ticket.createdAt : '',
    closed: ticket.status === 'closed',
    messages,
    latest: last === undefined ? null : preview(last.body),
  }
}

export function toTicketViews(tickets: readonly Ticket[]): TicketView[] {
  return tickets.map(toTicketView)
}
