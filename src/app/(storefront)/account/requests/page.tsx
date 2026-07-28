/**
 * `/account/requests` — the customer's own support requests.
 *
 * Scoped by the session, in the query. `listForCustomer` returns nothing at all for a visitor who
 * is not signed in, and constrains by the session's customer id for one who is — so another
 * customer's ticket is never fetched rather than being fetched and filtered (OWASP A01).
 *
 * The signed-out state is a real page rather than a redirect, because J8 has not built the login
 * yet: sending visitors to a route that does not exist would be worse than telling them plainly.
 * When J8 lands, the link below is the only thing that changes.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { getPayload } from 'payload'

import config from '@payload-config'
import { EmptyState } from '@/components/ui/EmptyState'
import { readCustomerSession } from '@/lib/auth/customerSession'
import { createPayloadTickets } from '@/lib/support/payloadTickets'
import { TICKET_STATUS_LABELS, toTicketViews } from '@/lib/support/ticketView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'My requests',
  // A customer's own support queue is not a page for a search engine, whatever the access rules do.
  robots: { index: false, follow: false },
}

function formatDate(iso: string): string {
  const at = new Date(iso)

  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

export default async function RequestsPage() {
  const payload = await getPayload({ config })
  const session = await readCustomerSession(await headers(), payload)

  if (session === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Sign in to see your requests"
          description="Your support requests live with your account, so we know it is you before showing the thread."
          action={
            <Link href="/" className="text-accent text-sm font-medium underline underline-offset-4">
              Back to the shop
            </Link>
          }
        />
      </div>
    )
  }

  const tickets = toTicketViews(
    await createPayloadTickets({ payload }).listForCustomer(session.user),
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-fg text-2xl font-medium">My requests</h1>

      {tickets.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="When you need a hand with an order, raise a request and the thread will appear here."
        />
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {tickets.map((ticket) => (
            <li key={ticket.ticketNumber}>
              <Link
                href={`/account/requests/${ticket.ticketNumber}`}
                className="border-border hover:bg-surface-raised flex flex-col gap-1 rounded-card border p-4 transition-colors duration-fast ease-out"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-fg font-medium">{ticket.subject}</span>
                  <span className="text-fg-subtle shrink-0 text-xs">
                    {TICKET_STATUS_LABELS[ticket.status]}
                  </span>
                </div>
                {ticket.latest ? <p className="text-fg-muted text-sm">{ticket.latest}</p> : null}
                <span className="text-fg-subtle text-xs">
                  {ticket.ticketNumber} · {formatDate(ticket.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
