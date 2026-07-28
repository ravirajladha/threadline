/**
 * `/account/requests/[number]` — one support thread.
 *
 * The ticket number is in the URL, and it authorises nothing. `tickets.find` looks it up *and*
 * checks the owner, so a customer pasting a reference from somebody else's email gets the same
 * `notFound()` as a reference that does not exist. That the two are indistinguishable is the point:
 * a 403 would confirm the ticket is real (OWASP A01).
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@payload-config'
import { TicketThread } from '@/components/support/TicketThread'
import { EmptyState } from '@/components/ui/EmptyState'
import { readCustomerSession } from '@/lib/auth/customerSession'
import { createPayloadTickets } from '@/lib/support/payloadTickets'
import { TICKET_STATUS_LABELS, toTicketView } from '@/lib/support/ticketView'

export const dynamic = 'force-dynamic'

type Params = Promise<{ number: string }>

export const metadata: Metadata = {
  title: 'Request',
  robots: { index: false, follow: false },
}

export default async function RequestPage({ params }: { params: Params }) {
  const { number } = await params

  const payload = await getPayload({ config })
  const session = await readCustomerSession(await headers(), payload)

  if (session === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Sign in to see this request"
          description="We check it is you before showing a support thread."
          action={
            <Link href="/" className="text-accent text-sm font-medium underline underline-offset-4">
              Back to the shop
            </Link>
          }
        />
      </div>
    )
  }

  const ticket = await createPayloadTickets({ payload }).find(number, session.user)

  // Not theirs and does not exist answer identically.
  if (ticket === null) notFound()

  const view = toTicketView(ticket)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/account/requests"
          className="text-fg-muted hover:text-fg text-sm transition-colors duration-fast ease-out"
        >
          ← All requests
        </Link>
        <h1 className="text-fg text-2xl font-medium">{view.subject}</h1>
        <p className="text-fg-subtle text-sm">
          {view.ticketNumber} · {TICKET_STATUS_LABELS[view.status]}
        </p>
      </div>

      <TicketThread
        ticketNumber={view.ticketNumber}
        messages={view.messages}
        closed={view.closed}
      />
    </div>
  )
}
