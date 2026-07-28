'use client'

import { useState } from 'react'

import { MAX_MESSAGE_LENGTH } from '@/lib/support/thread'
import type { TicketMessageView } from '@/lib/support/ticketView'

/**
 * A support thread, and the box to add to it.
 *
 * **Every message body renders as text.** React escapes it, and nothing here goes near
 * `dangerouslySetInnerHTML` — a support thread is the one place in the storefront where a stranger's
 * text is displayed back to a member of staff, which is exactly where stored XSS lives (OWASP A03).
 * `whitespace-pre-wrap` preserves the customer's line breaks without interpreting anything.
 *
 * The reply box is hidden rather than disabled when the thread is closed, because there is nothing
 * the customer can do about it here — the page tells them to raise a new request instead.
 */

export interface TicketThreadProps {
  ticketNumber: string
  messages: TicketMessageView[]
  closed: boolean
}

function formatSentAt(iso: string): string {
  const at = new Date(iso)

  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export function TicketThread({ ticketNumber, messages, closed }: TicketThreadProps): React.ReactElement {
  const [thread, setThread] = useState(messages)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', ticketNumber, body }),
      })

      const result = (await response.json()) as { error?: string }

      if (!response.ok) {
        setError(result.error ?? 'Your message could not be sent.')
        return
      }

      // Appended locally so the customer sees their message immediately. The server is still the
      // authority — a reload re-reads the thread — but a reply that vanishes until refresh reads
      // as a failure.
      setThread((current) => [
        ...current,
        {
          author: 'You',
          authorType: 'customer',
          body: body.trim(),
          sentAt: new Date().toISOString(),
          fromCustomer: true,
        },
      ])
      setBody('')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-4">
        {thread.map((message, index) => (
          <li
            key={`${message.sentAt}-${index}`}
            className={`flex flex-col gap-1 ${message.fromCustomer ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`text-fg max-w-prose rounded-card px-4 py-3 text-sm ${
                message.fromCustomer ? 'bg-accent-subtle' : 'bg-surface-raised'
              }`}
            >
              {/* Text, never HTML. See the note at the top of this file. */}
              <p className="whitespace-pre-wrap">{message.body}</p>
            </div>
            <span className="text-fg-subtle text-xs">
              {message.author} · {formatSentAt(message.sentAt)}
            </span>
          </li>
        ))}
      </ol>

      {closed ? (
        <p className="text-fg-muted text-sm">
          This request is closed. If you still need help, please raise a new one and mention{' '}
          {ticketNumber}.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-fg text-sm font-medium" htmlFor="support-reply">
            Add a message
          </label>
          <textarea
            id="support-reply"
            rows={4}
            maxLength={MAX_MESSAGE_LENGTH}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="border-border bg-surface text-fg rounded-control border px-3 py-2 text-sm"
            placeholder="Tell us more…"
          />
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              disabled={busy || body.trim() === ''}
              onClick={() => void send()}
              className="bg-accent text-accent-fg hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
