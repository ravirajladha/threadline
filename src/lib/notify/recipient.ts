/**
 * Turning a stored customer into a `Recipient`.
 *
 * One function, in one place, because three jobs and a status transition all need the same
 * reduction and getting it slightly different in each is how a customer gets greeted by their full
 * legal name in one email and their first name in the next.
 *
 * **A greeting takes the first name only.** `customers.name` holds whatever the customer typed, so
 * this splits on whitespace and takes the first token — a heuristic, and stated as one. It is wrong
 * for some naming conventions, which is exactly why `greeting()` in `templates.ts` falls back to
 * "Hi there," rather than to something that would read as a mistake.
 */
import type { Recipient } from './types'

/** The first whitespace-separated token of a name, or null if there is nothing usable. */
export function firstNameOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? ''
  if (trimmed.length === 0) return null

  return trimmed.split(/\s+/)[0] ?? null
}

/**
 * An email recipient, or null when there is no address to write to.
 *
 * Returning null rather than an empty address is the point: "nowhere to send this" is a decision a
 * caller has to make, and a `Recipient` with a blank address is a message that gets attempted,
 * fails, and leaves a row nobody can act on.
 */
export function emailRecipient(input: {
  email: string | null | undefined
  name?: string | null
}): Recipient | null {
  const address = input.email?.trim() ?? ''
  if (address.length === 0) return null

  return { address, name: firstNameOf(input.name) }
}
