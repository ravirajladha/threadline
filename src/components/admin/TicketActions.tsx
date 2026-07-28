'use client'

import { useCallback, useState } from 'react'
import { Button, useDocumentInfo, useFormFields } from '@payloadcms/ui'

import { canTransitionTicket } from '@/lib/support/transitions'
import { MAX_MESSAGE_LENGTH } from '@/lib/support/thread'
import { TICKET_STATUSES, type TicketStatus } from '@/types'

/**
 * The agent's side of a ticket, on the ticket edit view.
 *
 * Replying is a box and a button rather than a row appended to the `messages` array in the form,
 * because a reply is not a field edit: it stamps `firstResponseAt`, moves the status and emails the
 * customer. Doing it through the endpoint means an agent gets all three, and cannot get one without
 * the others by saving the array by hand.
 *
 * Which status moves are offered comes from `canTransitionTicket` — the same function the port
 * validates with — so a button that is shown is a button that works. A move the machine forbids is
 * not rendered at all here, unlike the fulfilment panel: on an order the refusals are informative
 * ("book a courier first"), whereas "a closed ticket cannot be reopened" is better expressed by the
 * button simply not being there next to a status that already says `closed`.
 */

const STATUS_LABELS: Readonly<Record<TicketStatus, string>> = {
  open: 'Reopen',
  pending_customer: 'Waiting on customer',
  resolved: 'Resolve',
  closed: 'Close',
}

interface ActionResponse {
  ok?: boolean
  error?: string
}

export function TicketActions(): React.ReactElement {
  const { id } = useDocumentInfo()

  const ticketNumber = useFormFields(([fields]) => {
    const value = fields?.ticketNumber?.value

    return typeof value === 'string' && value.length > 0 ? value : null
  })

  const status = useFormFields(([fields]) => {
    const value = fields?.status?.value

    return typeof value === 'string' ? (value as TicketStatus) : null
  })

  const [reply, setReply] = useState('')
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  const post = useCallback(
    async (path: string, body: Record<string, unknown>, success: string): Promise<void> => {
      if (ticketNumber === null) {
        setMessage({ text: 'Save the ticket before acting on it.', kind: 'error' })
        return
      }

      setBusy(true)
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(ticketNumber)}/${path}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        const result = (await response.json()) as ActionResponse

        setMessage(
          response.ok
            ? { text: success, kind: 'ok' }
            : { text: result.error ?? 'That did not work.', kind: 'error' },
        )

        if (response.ok && path === 'reply') setReply('')
      } catch {
        setMessage({ text: 'The request failed. Check your connection and try again.', kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [ticketNumber],
  )

  if (!id || status === null) {
    return <div className="threadline-action">Loading ticket actions…</div>
  }

  const moves = TICKET_STATUSES.filter((candidate) => canTransitionTicket(status, candidate))

  return (
    <div className="threadline-action">
      <span className="threadline-action__title">Reply</span>
      <p className="threadline-action__hint">
        Your reply is added to the thread as “Threadline Support”, marks the response time, moves the
        ticket to waiting-on-customer and emails them.
      </p>

      <label className="threadline-action__field">
        Message
        <textarea
          rows={5}
          maxLength={MAX_MESSAGE_LENGTH}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Write to the customer…"
        />
      </label>

      <div className="threadline-action__row">
        <Button
          disabled={busy || reply.trim() === ''}
          onClick={() => void post('reply', { body: reply }, 'Reply sent. Reload to see it on the thread.')}
        >
          Send reply
        </Button>

        {moves.map((candidate) => (
          <Button
            key={candidate}
            buttonStyle="secondary"
            disabled={busy}
            onClick={() =>
              void post('status', { status: candidate }, `Ticket is now ${candidate.replace(/_/g, ' ')}.`)
            }
          >
            {STATUS_LABELS[candidate]}
          </Button>
        ))}
      </div>

      {message ? (
        <p className={`threadline-action__status threadline-action__status--${message.kind}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  )
}

export default TicketActions
