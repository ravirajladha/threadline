/**
 * Support — the reference, the status machine, the thread rules and the port.
 *
 * The port's tests are mostly about **ownership**, because that is where a support surface goes
 * wrong: a ticket number travels in emails and URLs, so anything that treats holding one as
 * permission to read the thread hands out strangers' conversations. Every lookup here is asserted
 * to check the owner as well as the number.
 */
import { describe, expect, it, vi } from 'vitest'

import { createPayloadTickets } from '@/lib/support/payloadTickets'
import {
  appendMessage,
  describeThreadRefusal,
  MAX_MESSAGE_LENGTH,
  type ThreadState,
} from '@/lib/support/thread'
import {
  buildTicketNumber,
  isTicketNumber,
  parseTicketNumber,
  ticketDatePrefix,
} from '@/lib/support/ticketNumber'
import {
  assertTicketTransition,
  canTransitionTicket,
  IllegalTicketTransitionError,
  isTerminalTicketStatus,
  TICKET_TRANSITIONS,
} from '@/lib/support/transitions'
import { TICKET_STATUS_LABELS, toTicketView } from '@/lib/support/ticketView'
import { Tickets } from '@/collections/Tickets'
import { isOrderNumber } from '@/lib/orders/orderNumber'
import { buildReference, datePrefixOf, parseReference } from '@/lib/utils/reference'
import { TICKET_STATUSES } from '@/types'
import type { Payload } from 'payload'

const NOW = new Date('2026-07-28T10:00:00.000Z')

describe('ticket numbers', () => {
  it('reads as a date and a daily sequence', () => {
    expect(buildTicketNumber({ date: NOW, sequence: 7 })).toBe('TS-260728-0007')
  })

  it('round-trips', () => {
    expect(parseTicketNumber('TS-260728-0007')).toEqual({
      prefix: 'TS',
      datePart: '260728',
      sequence: 7,
    })
  })

  it('survives a customer pasting it in lower case with spaces', () => {
    expect(parseTicketNumber('  ts-260728-0007 ')).not.toBeNull()
  })

  it('is not an order number, and an order number is not one of these', () => {
    // The bug this closes: the old any-prefix parser accepted `TS-…` as a valid *order* number, so
    // a support search would have gone looking through orders and found nothing, with no clue why.
    expect(isOrderNumber('TS-260728-0007')).toBe(false)
    expect(isTicketNumber('TL-260728-0007')).toBe(false)
    expect(isTicketNumber('TS-260728-0007')).toBe(true)
  })

  it('yields the prefix used to count the day’s tickets', () => {
    expect(ticketDatePrefix('TS-260728-0007')).toBe('TS-260728-')
  })
})

describe('collection access', () => {
  /** Payload calls these with a request; only `user` is ever read. */
  const call = (fn: unknown, user: unknown): unknown =>
    (fn as (args: { req: { user: unknown } }) => unknown)({ req: { user } })

  it('does not let a customer create a ticket through the collection', () => {
    // Payload exposes `POST /api/tickets` whatever our routes do. Letting a customer through meant
    // they chose their own ticket number, their own `firstResponseAt`, and — the real one — an
    // opening message with `authorType: 'agent'` signed "Threadline Support" (OWASP A04).
    expect(call(Tickets.access?.create, CUSTOMER)).toBe(false)
    expect(call(Tickets.access?.create, null)).toBe(false)
  })

  it('still lets an agent raise one on a customer’s behalf', () => {
    expect(call(Tickets.access?.create, AGENT)).toBe(true)
  })

  it('scopes a customer’s read to their own tickets in the query', () => {
    // A `Where` rather than a boolean: the database never returns another customer's row, so there
    // is nothing for a forgotten filter downstream to leak (OWASP A01).
    expect(call(Tickets.access?.read, CUSTOMER)).toMatchObject({ customer: { equals: 5 } })
    expect(call(Tickets.access?.read, null)).toBe(false)
    expect(call(Tickets.access?.read, AGENT)).toBe(true)
  })

  it('refuses a customer writing to the row directly', () => {
    // Otherwise a customer could PATCH `messages` and rewrite what an agent said.
    expect(call(Tickets.access?.update, CUSTOMER)).toBe(false)
  })
})

describe('shared references', () => {
  it('refuses a sequence that is not a whole number of at least one', () => {
    for (const sequence of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildReference({ date: NOW, sequence, prefix: 'TS' })).toThrow(RangeError)
    }
  })

  it('refuses an invalid date', () => {
    expect(() => buildReference({ date: new Date('nonsense'), sequence: 1, prefix: 'TS' })).toThrow(RangeError)
  })

  it('lets a sequence grow past four digits rather than wrapping into a collision', () => {
    expect(buildReference({ date: NOW, sequence: 12_345, prefix: 'TL' })).toBe('TL-260728-12345')
  })

  it('insists on the prefix it was asked for', () => {
    // The whole reason the prefix is a parameter rather than a capture group.
    expect(parseReference('TS-260728-0001', 'TL')).toBeNull()
    expect(parseReference('TS-260728-0001', 'TS')).not.toBeNull()
  })

  it('rejects anything that is not this shape', () => {
    for (const value of ['', 'TS', 'TS-2607-0001', 'TS-260728-1', '../../etc', 'TS-260728-0001-X']) {
      expect(parseReference(value, 'TS')).toBeNull()
    }
  })

  it('derives the counting prefix from a real reference rather than formatting it twice', () => {
    expect(datePrefixOf(buildReference({ date: NOW, sequence: 3, prefix: 'TS' }))).toBe('TS-260728-')
  })
})

describe('ticket view models', () => {
  const doc = {
    ticketNumber: 'TS-260728-0001',
    subject: 'Wrong size',
    status: 'open',
    category: 'return',
    createdAt: NOW.toISOString(),
    messages: [
      { author: 'You', authorType: 'customer', body: 'Too small', sentAt: NOW.toISOString() },
      { author: 'Threadline Support', authorType: 'agent', body: 'Sending a large', sentAt: NOW.toISOString() },
    ],
  } as never

  it('flattens a thread and marks which side each message is on', () => {
    const view = toTicketView(doc)

    expect(view.messages).toHaveLength(2)
    expect(view.messages[0]?.fromCustomer).toBe(true)
    expect(view.messages[1]?.fromCustomer).toBe(false)
  })

  it('previews the latest message for the list', () => {
    expect(toTicketView(doc).latest).toBe('Sending a large')
  })

  it('trims a long preview rather than pasting an essay into a list', () => {
    const view = toTicketView({
      ...(doc as unknown as Record<string, unknown>),
      messages: [{ author: 'You', authorType: 'customer', body: 'x'.repeat(400), sentAt: NOW.toISOString() }],
    } as never)

    expect(view.latest?.length).toBeLessThan(140)
    expect(view.latest?.endsWith('…')).toBe(true)
  })

  it('collapses newlines in a preview', () => {
    const view = toTicketView({
      ...(doc as unknown as Record<string, unknown>),
      messages: [{ author: 'You', authorType: 'customer', body: 'one\n\ntwo', sentAt: NOW.toISOString() }],
    } as never)

    expect(view.latest).toBe('one two')
  })

  it('carries nothing about the customer or the assigned agent', () => {
    // Every field a view model omits is a field that cannot leak through it.
    const view = toTicketView({
      ...(doc as unknown as Record<string, unknown>),
      customer: 5,
      assignedTo: 2,
    } as never)

    expect(view).not.toHaveProperty('customer')
    expect(view).not.toHaveProperty('assignedTo')
  })

  it('flags a closed thread so the reply box is not offered', () => {
    expect(toTicketView({ ...(doc as unknown as Record<string, unknown>), status: 'closed' } as never).closed).toBe(
      true,
    )
    expect(toTicketView(doc).closed).toBe(false)
  })

  it('labels every status for a customer to read', () => {
    for (const status of TICKET_STATUSES) {
      expect(TICKET_STATUS_LABELS[status].length).toBeGreaterThan(0)
    }
  })

  it('survives a ticket with no messages at all', () => {
    const view = toTicketView({ ...(doc as unknown as Record<string, unknown>), messages: [] } as never)

    expect(view.messages).toEqual([])
    expect(view.latest).toBeNull()
  })
})

describe('ticket status machine', () => {
  it('bounces between open and pending', () => {
    expect(canTransitionTicket('open', 'pending_customer')).toBe(true)
    expect(canTransitionTicket('pending_customer', 'open')).toBe(true)
  })

  it('lets a resolved ticket be reopened', () => {
    // A customer writing again after being told they were helped has not been helped, and a second
    // ticket would carry none of the history.
    expect(canTransitionTicket('resolved', 'open')).toBe(true)
  })

  it('treats closed as the end', () => {
    expect(isTerminalTicketStatus('closed')).toBe(true)
    for (const status of TICKET_STATUSES) {
      expect(canTransitionTicket('closed', status)).toBe(false)
    }
  })

  it('refuses a move to the same status', () => {
    // Looks harmless; it is how a double-clicked button fires a second resolution email.
    for (const status of TICKET_STATUSES) {
      expect(canTransitionTicket(status, status)).toBe(false)
    }
  })

  it('throws on an illegal move', () => {
    expect(() => assertTicketTransition('closed', 'open')).toThrow(IllegalTicketTransitionError)
  })

  it('has an entry for every status', () => {
    for (const status of TICKET_STATUSES) {
      expect(TICKET_TRANSITIONS).toHaveProperty(status)
    }
  })
})

describe('thread', () => {
  const state = (overrides: Partial<ThreadState> = {}): ThreadState => ({
    status: 'open',
    firstResponseAt: null,
    ...overrides,
  })

  const append = (input: Partial<Parameters<typeof appendMessage>[0]> = {}) =>
    appendMessage({
      state: state(),
      authorType: 'customer',
      author: 'You',
      body: 'My parcel has not arrived.',
      now: NOW,
      ...input,
    })

  it('appends a trimmed message with the time it was sent', () => {
    const result = append({ body: '  needs a bigger size  ' })

    expect(result).toMatchObject({
      ok: true,
      message: { body: 'needs a bigger size', authorType: 'customer', sentAt: NOW.toISOString() },
    })
  })

  it('moves the ticket to the customer when an agent replies', () => {
    const result = append({ authorType: 'agent', author: 'Threadline Support' })

    expect(result).toMatchObject({ ok: true, effect: { toStatus: 'pending_customer' } })
  })

  it('brings it back when the customer replies', () => {
    const result = append({ state: state({ status: 'pending_customer' }) })

    expect(result).toMatchObject({ ok: true, effect: { toStatus: 'open' } })
  })

  it('reopens a resolved ticket the customer writes into', () => {
    expect(append({ state: state({ status: 'resolved' }) })).toMatchObject({
      ok: true,
      effect: { toStatus: 'open' },
    })
  })

  it('stamps the first agent reply', () => {
    expect(append({ authorType: 'agent' })).toMatchObject({
      effect: { firstResponseAt: NOW.toISOString() },
    })
  })

  it('never restamps it', () => {
    // The column answers "how fast do we reply". Overwriting it reports the last reply as the first.
    const result = append({
      authorType: 'agent',
      state: state({ status: 'open', firstResponseAt: '2026-07-27T09:00:00.000Z' }),
    })

    expect(result).toMatchObject({ effect: { firstResponseAt: null } })
  })

  it('does not stamp it for a customer message', () => {
    expect(append()).toMatchObject({ effect: { firstResponseAt: null } })
  })

  it('accepts nothing on a closed thread', () => {
    expect(append({ state: state({ status: 'closed' }) })).toMatchObject({ ok: false, reason: 'closed' })
  })

  it('refuses an empty message', () => {
    expect(append({ body: '    ' })).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('refuses a message far longer than any complaint', () => {
    // An unbounded text field reachable from the storefront is a way to fill the database.
    expect(append({ body: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).toMatchObject({
      ok: false,
      reason: 'too_long',
    })
  })

  it('still records a message whose implied status move is illegal', () => {
    // A bot message implies no move at all; refusing to record what somebody said would be worse
    // than leaving the status alone.
    expect(append({ authorType: 'bot', author: 'Assistant' })).toMatchObject({
      ok: true,
      effect: { toStatus: null },
    })
  })

  it('explains every refusal in a sentence', () => {
    for (const reason of ['closed', 'empty', 'too_long'] as const) {
      expect(describeThreadRefusal(reason).length).toBeGreaterThan(10)
    }
  })
})

// --- The port ----------------------------------------------------------------

interface FakeTicket {
  id: number
  ticketNumber: string
  customer: number
  subject: string
  status: string
  messages: Array<Record<string, unknown>>
  firstResponseAt?: string | null
  assignedTo?: number | null
  resolvedAt?: string | null
}

const TICKET: FakeTicket = {
  id: 1,
  ticketNumber: 'TS-260728-0001',
  customer: 5,
  subject: 'Wrong size',
  status: 'open',
  messages: [{ author: 'You', authorType: 'customer', body: 'Too small', sentAt: NOW.toISOString() }],
  firstResponseAt: null,
}

function fakePayload(ticket: FakeTicket | null = TICKET, orders: Array<{ id: number; customer: number }> = []) {
  const state = {
    tickets: ticket === null ? [] : [{ ...ticket }],
    created: [] as Array<Record<string, unknown>>,
    logged: [] as unknown[],
  }

  const payload = {
    logger: {
      info: (p: unknown) => state.logged.push(p),
      warn: (p: unknown) => state.logged.push(p),
      error: (p: unknown) => state.logged.push(p),
    },
    db: {},
    async count(): Promise<{ totalDocs: number }> {
      return { totalDocs: state.tickets.length }
    },
    async find({ collection, where }: { collection: string; where?: unknown }): Promise<{ docs: unknown[] }> {
      if (collection === 'tickets') {
        const number = (where as { ticketNumber?: { equals?: string } })?.ticketNumber?.equals
        const customer = (where as { customer?: { equals?: number } })?.customer?.equals

        if (number !== undefined) return { docs: state.tickets.filter((row) => row.ticketNumber === number) }
        if (customer !== undefined) return { docs: state.tickets.filter((row) => row.customer === customer) }

        return { docs: state.tickets }
      }

      if (collection === 'orders') {
        const clauses = (where as { and?: Array<Record<string, { equals?: number }>> })?.and ?? []
        const id = clauses[0]?.id?.equals
        const customer = clauses[1]?.customer?.equals

        return { docs: orders.filter((order) => order.id === id && order.customer === customer) }
      }

      return { docs: [] }
    },
    async findByID({ collection }: { collection: string }): Promise<unknown> {
      if (collection === 'customers') return { id: 5, email: 'asha@example.com', name: 'Asha Menon' }

      return null
    },
    async create({ collection, data }: { collection: string; data: Record<string, unknown> }): Promise<unknown> {
      state.created.push({ collection, ...data })

      if (collection === 'tickets') {
        state.tickets.push({ ...(data as unknown as FakeTicket), id: state.tickets.length + 1 })
      }

      return { id: state.tickets.length }
    },
    async update({ id, data }: { id: number; data: Record<string, unknown> }): Promise<unknown> {
      const row = state.tickets.find((entry) => entry.id === id)
      if (row !== undefined) Object.assign(row, data)

      return row
    },
  }

  return { state, payload: payload as unknown as Payload }
}

const CUSTOMER = { id: 5, collection: 'customers' }
const OTHER_CUSTOMER = { id: 6, collection: 'customers' }
const AGENT = { id: 2, collection: 'users', role: 'support_agent', isActive: true }
const CATALOG_MANAGER = { id: 3, collection: 'users', role: 'catalog_manager', isActive: true }

function tickets(ticket: FakeTicket | null = TICKET, orders: Array<{ id: number; customer: number }> = []) {
  const { state, payload } = fakePayload(ticket, orders)
  const dispatch = vi.fn().mockResolvedValue({ status: 'sent' })

  return {
    state,
    dispatch,
    port: createPayloadTickets({ payload, notify: { dispatch } as never }),
  }
}

describe('raise', () => {
  it('opens a ticket for the signed-in customer', async () => {
    const { port } = tickets(null)

    const result = await port.raise({
      user: CUSTOMER,
      subject: 'Wrong size',
      body: 'The medium is too small.',
      category: 'return',
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, ticketNumber: 'TS-260728-0001' })
  })

  it('refuses an anonymous caller', async () => {
    const { port } = tickets(null)

    expect(
      await port.raise({ user: null, subject: 'Hello', body: 'Anyone there', category: 'other' }),
    ).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('refuses a blank subject', async () => {
    const { port } = tickets(null)

    expect(
      await port.raise({ user: CUSTOMER, subject: '   ', body: 'Something', category: 'other' }),
    ).toMatchObject({ ok: false, detail: 'no_subject' })
  })

  it('holds the opening message to the same rules as a reply', async () => {
    const { port } = tickets(null)

    expect(
      await port.raise({ user: CUSTOMER, subject: 'Hi', body: '   ', category: 'other' }),
    ).toMatchObject({ ok: false, detail: 'empty' })
  })

  it('attaches an order the customer actually owns', async () => {
    const { state, port } = tickets(null, [{ id: 90, customer: 5 }])

    await port.raise({
      user: CUSTOMER,
      subject: 'Where is it',
      body: 'Not arrived',
      category: 'order',
      orderId: 90,
      now: NOW,
    })

    expect(state.created[0]).toMatchObject({ collection: 'tickets', order: 90 })
  })

  it('silently drops an order belonging to somebody else', async () => {
    // Dropped rather than refused: the request is legitimate and the attachment is a convenience.
    // Refusing would tell a prober which order ids exist.
    const { state, port } = tickets(null, [{ id: 90, customer: 999 }])

    const result = await port.raise({
      user: CUSTOMER,
      subject: 'Where is it',
      body: 'Not arrived',
      category: 'order',
      orderId: 90,
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true })
    expect(state.created[0]).not.toHaveProperty('order')
  })
})

describe('reply — ownership', () => {
  it('lets the owner reply to their own ticket', async () => {
    const { state, port } = tickets()

    const result = await port.reply({
      user: CUSTOMER,
      ticketNumber: TICKET.ticketNumber,
      body: 'Still waiting',
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true })
    expect(state.tickets[0]?.messages).toHaveLength(2)
  })

  it('tells another customer the ticket does not exist', async () => {
    // Not "forbidden": distinguishing the two confirms the reference is real, and a ticket number
    // travels in emails and URLs.
    const { state, port } = tickets()

    const result = await port.reply({
      user: OTHER_CUSTOMER,
      ticketNumber: TICKET.ticketNumber,
      body: 'Let me see that',
      now: NOW,
    })

    expect(result).toEqual({ ok: false, reason: 'not_found' })
    expect(state.tickets[0]?.messages).toHaveLength(1)
  })

  it('refuses an anonymous caller holding a real reference', async () => {
    const { port } = tickets()

    expect(
      await port.reply({ user: null, ticketNumber: TICKET.ticketNumber, body: 'Hello', now: NOW }),
    ).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('matches an owner whose session id arrived as a string', async () => {
    // `req.user.id` can come back as a string from a token while the relationship is an integer,
    // and a `===` between those is silently always false — which would deny every customer their
    // own ticket.
    const { port } = tickets()

    expect(
      await port.reply({
        user: { id: '5', collection: 'customers' },
        ticketNumber: TICKET.ticketNumber,
        body: 'Still waiting',
        now: NOW,
      }),
    ).toMatchObject({ ok: true })
  })

  it('lets a support agent reply to anyone’s ticket', async () => {
    const { state, port } = tickets()

    const result = await port.reply({
      user: AGENT,
      ticketNumber: TICKET.ticketNumber,
      body: 'We have sent a replacement.',
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, message: { authorType: 'agent' } })
    expect(state.tickets[0]?.status).toBe('pending_customer')
  })

  it('refuses staff without support permission', async () => {
    // `catalog_manager` has `support: none` in the role matrix. They are refused *before* the
    // lookup, so `forbidden` here reveals nothing about the ticket — unlike the customer case
    // above, where the caller is entitled to an answer and the answer must not confirm the
    // reference is real.
    const { state, port } = tickets()

    expect(
      await port.reply({
        user: CATALOG_MANAGER,
        ticketNumber: TICKET.ticketNumber,
        body: 'Just looking',
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'forbidden' })

    expect(state.tickets[0]?.messages).toHaveLength(1)
  })

  it('never lets a caller choose the name their message is signed with', async () => {
    // A caller picking their own display name could post a message that reads as though support
    // wrote it.
    const { state, port } = tickets()

    await port.reply({ user: CUSTOMER, ticketNumber: TICKET.ticketNumber, body: 'Hi', now: NOW })

    expect(state.tickets[0]?.messages[1]).toMatchObject({ author: 'You', authorType: 'customer' })
  })

  it('stamps the first agent reply on the row', async () => {
    const { state, port } = tickets()

    await port.reply({ user: AGENT, ticketNumber: TICKET.ticketNumber, body: 'On it', now: NOW })

    expect(state.tickets[0]?.firstResponseAt).toBe(NOW.toISOString())
  })

  it('emails the customer when an agent replies', async () => {
    const { dispatch, port } = tickets()

    await port.reply({ user: AGENT, ticketNumber: TICKET.ticketNumber, body: 'On it', now: NOW })

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      event: 'ticket.replied',
      recipient: { address: 'asha@example.com', name: 'Asha' },
    })
  })

  it('does not email a customer about their own message', async () => {
    const { dispatch, port } = tickets()

    await port.reply({ user: CUSTOMER, ticketNumber: TICKET.ticketNumber, body: 'Hi', now: NOW })

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('gives each agent reply its own notification subject', async () => {
    // Otherwise the second reply on a thread is suppressed as a duplicate of the first.
    const { dispatch, port } = tickets()

    await port.reply({ user: AGENT, ticketNumber: TICKET.ticketNumber, body: 'One', now: NOW })
    await port.reply({ user: AGENT, ticketNumber: TICKET.ticketNumber, body: 'Two', now: NOW })

    const subjects = dispatch.mock.calls.map((call) => (call[0] as { subject: string }).subject)

    expect(new Set(subjects).size).toBe(2)
  })

  it('completes the reply even when the notification fails', async () => {
    const { state, payload } = fakePayload()
    const port = createPayloadTickets({
      payload,
      notify: { dispatch: vi.fn().mockRejectedValue(new Error('mail is down')) } as never,
    })

    await port.reply({ user: AGENT, ticketNumber: TICKET.ticketNumber, body: 'On it', now: NOW })

    expect(state.tickets[0]?.messages).toHaveLength(2)
  })
})

describe('setStatus and assign', () => {
  it('lets an agent resolve a ticket and tells the customer', async () => {
    const { state, dispatch, port } = tickets()

    const result = await port.setStatus({
      user: AGENT,
      ticketNumber: TICKET.ticketNumber,
      toStatus: 'resolved',
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true })
    expect(state.tickets[0]).toMatchObject({ status: 'resolved', resolvedAt: NOW.toISOString() })
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ event: 'ticket.resolved' })
  })

  it('refuses a customer trying to close their own ticket', async () => {
    const { port } = tickets()

    expect(
      await port.setStatus({ user: CUSTOMER, ticketNumber: TICKET.ticketNumber, toStatus: 'closed' }),
    ).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('returns an illegal move rather than throwing', async () => {
    // An agent clicking a stale button is an ordinary event, not a webhook with nobody to tell.
    const { port } = tickets({ ...TICKET, status: 'closed' })

    expect(
      await port.setStatus({ user: AGENT, ticketNumber: TICKET.ticketNumber, toStatus: 'open' }),
    ).toMatchObject({ ok: false, detail: 'bad_status' })
  })

  it('assigns and unassigns', async () => {
    const { state, port } = tickets()

    await port.assign({ user: AGENT, ticketNumber: TICKET.ticketNumber, assignTo: 2 })
    expect(state.tickets[0]?.assignedTo).toBe(2)

    await port.assign({ user: AGENT, ticketNumber: TICKET.ticketNumber, assignTo: null })
    expect(state.tickets[0]?.assignedTo).toBeNull()
  })

  it('refuses assignment from a customer', async () => {
    const { port } = tickets()

    expect(
      await port.assign({ user: CUSTOMER, ticketNumber: TICKET.ticketNumber, assignTo: 2 }),
    ).toEqual({ ok: false, reason: 'forbidden' })
  })
})

describe('reading', () => {
  it('finds a ticket for its owner and hides it from everyone else', async () => {
    const { port } = tickets()

    expect(await port.find(TICKET.ticketNumber, CUSTOMER)).not.toBeNull()
    expect(await port.find(TICKET.ticketNumber, OTHER_CUSTOMER)).toBeNull()
    expect(await port.find(TICKET.ticketNumber, null)).toBeNull()
    expect(await port.find(TICKET.ticketNumber, AGENT)).not.toBeNull()
  })

  it('lists only the signed-in customer’s tickets', async () => {
    const { port } = tickets()

    expect(await port.listForCustomer(CUSTOMER)).toHaveLength(1)
    expect(await port.listForCustomer(OTHER_CUSTOMER)).toHaveLength(0)
    expect(await port.listForCustomer(null)).toHaveLength(0)
  })

  it('never logs a customer’s message body', async () => {
    // A support thread is the most personal text in the system.
    const { state, port } = tickets()

    await port.reply({
      user: CUSTOMER,
      ticketNumber: TICKET.ticketNumber,
      body: 'my address is 14 Rose Lane',
      now: NOW,
    })

    expect(JSON.stringify(state.logged)).not.toContain('Rose Lane')
  })
})
