/**
 * What appending a message does to a ticket.
 *
 * The naive version sets the status by hand at each call site — the agent reply endpoint writes
 * `pending_customer`, the customer reply endpoint writes `open` — and within a month there is a
 * path that forgets, and a queue full of tickets whose status describes nobody's reality.
 *
 * So the message is the input and the status is *derived*:
 *
 * - **An agent replying moves an open ticket to `pending_customer`.** The ball is with the customer,
 *   and that is what "waiting on them" is for.
 * - **A customer replying moves it back to `open`** — including from `resolved`, because a customer
 *   who writes again after being told they were helped has not been helped.
 * - **The first agent reply stamps `firstResponseAt`**, once and never again. That column is how
 *   response time becomes a number rather than an impression, and overwriting it would quietly
 *   report the *last* reply as the first.
 * - **A closed ticket accepts nothing.** Its thread is history.
 *
 * Pure, so all of that is a table of cases rather than something discovered in production.
 */
import { canTransitionTicket } from './transitions'
import type { MessageAuthorType, TicketStatus } from '@/types'

/** A message as it will be stored. `author` is a display name, resolved server-side. */
export interface ThreadMessage {
  author: string
  authorType: MessageAuthorType
  body: string
  sentAt: string
}

/** The ticket state a thread decision needs. Not the Payload document. */
export interface ThreadState {
  status: TicketStatus
  firstResponseAt: string | null
}

/** What the port should write, beyond appending the message itself. */
export interface ThreadEffect {
  /** Null when the status should not move. */
  toStatus: TicketStatus | null
  /** Set only on the first agent reply; null means leave the column alone. */
  firstResponseAt: string | null
}

export type ThreadAppend =
  | { ok: true; message: ThreadMessage; effect: ThreadEffect }
  | { ok: false; reason: ThreadRefusal }

export type ThreadRefusal =
  /** The thread is history. */
  | 'closed'
  /** Nothing but whitespace, or nothing at all. */
  | 'empty'
  /** Longer than a support message has any reason to be. */
  | 'too_long'

/**
 * The ceiling on a message body.
 *
 * Not politeness — an unbounded text field reachable by an anonymous-ish caller is a way to fill
 * the database a megabyte at a time. Generous enough that a real complaint fits comfortably.
 */
export const MAX_MESSAGE_LENGTH = 5_000

/** Which status a reply from this author implies, or null to leave it alone. */
function statusAfterReply(authorType: MessageAuthorType, current: TicketStatus): TicketStatus | null {
  const target: TicketStatus | null =
    authorType === 'customer' ? 'open' : authorType === 'agent' ? 'pending_customer' : null

  if (target === null) return null

  // Asking the machine rather than restating it, so this file can only ever be as permissive as the
  // graph. A reply that implies a move the graph forbids simply does not move the ticket — the
  // message is still appended, because refusing to record what somebody said would be worse.
  return canTransitionTicket(current, target) ? target : null
}

/**
 * Append a message to a thread.
 *
 * `now` is injected rather than read inside, so "the first reply stamps the timestamp" is a test
 * with an exact value rather than an approximation.
 */
export function appendMessage(input: {
  state: ThreadState
  authorType: MessageAuthorType
  author: string
  body: string
  now: Date
}): ThreadAppend {
  const { state, authorType, author, body, now } = input

  if (state.status === 'closed') return { ok: false, reason: 'closed' }

  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: 'too_long' }

  const sentAt = now.toISOString()

  return {
    ok: true,
    message: { author, authorType, body: trimmed, sentAt },
    effect: {
      toStatus: statusAfterReply(authorType, state.status),
      // Once, and never again: this column answers "how fast do we reply", and rewriting it on
      // every reply would report the most recent one as the first.
      firstResponseAt: authorType === 'agent' && state.firstResponseAt === null ? sentAt : null,
    },
  }
}

/** A short, human sentence for a refusal. Kept beside the reasons so one cannot outlive the other. */
export function describeThreadRefusal(reason: ThreadRefusal): string {
  switch (reason) {
    case 'closed':
      return 'This request is closed. Please raise a new one and mention this reference.'
    case 'empty':
      return 'Please write a message before sending.'
    case 'too_long':
      return `Please keep it under ${MAX_MESSAGE_LENGTH.toLocaleString('en-IN')} characters.`
  }
}
