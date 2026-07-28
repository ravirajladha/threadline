/**
 * Ticket numbers.
 *
 * `TS-260727-0007` is the seventh support request of 27 July 2026. The shape and its reasoning are
 * shared with order numbers in `lib/utils/reference.ts`; this file is the prefix and the names.
 *
 * Worth stating explicitly because support is where it will be tempting to break: **a ticket number
 * is not a password.** It appears in emails, in URLs and in whatever the customer pastes into a
 * chat, so nothing may treat holding one as permission to read the thread. `payloadTickets` looks a
 * ticket up by number *and* checks the owner, every time.
 */
import { buildReference, datePrefixOf, parseReference, type ParsedReference } from '@/lib/utils/reference'

export const TICKET_NUMBER_PREFIX = 'TS'

export function buildTicketNumber(input: { date: Date; sequence: number }): string {
  return buildReference({ ...input, prefix: TICKET_NUMBER_PREFIX })
}

export type ParsedTicketNumber = ParsedReference

export function parseTicketNumber(value: string): ParsedTicketNumber | null {
  return parseReference(value, TICKET_NUMBER_PREFIX)
}

export function isTicketNumber(value: string): boolean {
  return parseTicketNumber(value) !== null
}

/** The `TS-260727-` portion, for counting the day's tickets so far. */
export function ticketDatePrefix(ticketNumber: string): string {
  return datePrefixOf(ticketNumber)
}
