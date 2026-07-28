/**
 * The return status machine.
 *
 * The third machine in the codebase, and built the same way as the order and ticket ones for the
 * same reason: statuses arrive from a customer, an agent and a courier, and without a machine they
 * overwrite each other. Here the stakes are money — `refunded` is the state that has paid somebody
 * — so an illegal jump throws rather than being written.
 *
 * The graph, and the judgement in it:
 *
 * - `requested → approved | rejected`. An agent decides; nothing is collected before they do.
 * - `approved → picked_up → received`. Three steps rather than one because they are three real
 *   events with real gaps: the courier has it, and then we have it, and only the last is ours to
 *   verify.
 * - **`received → refunded` is the only route to money**, and `received` is the only state where
 *   stock goes back on the shelf. That is deliberate, and it is the same rule J5 stated when it
 *   refused to credit stock on delivery or RTO: units come back after somebody has looked at them,
 *   not because a tracking event said a parcel moved.
 * - `exchange_shipped` is terminal in place of a refund: the customer was sent a different size, so
 *   there is no money to return.
 * - `rejected` is terminal. A rejected return that could be revived would let a second agent
 *   quietly overturn the first with no record; a new return, referencing the old, is honest.
 */
import { RETURN_STATUSES, type ReturnStatus } from '@/types'

export const RETURN_TRANSITIONS: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> = Object.freeze({
  requested: ['approved', 'rejected'],
  approved: ['picked_up', 'rejected'],
  // A parcel can go missing between the doorstep and us, so `rejected` stays reachable.
  picked_up: ['received', 'rejected'],
  // The fork: money back, or a different size out.
  received: ['refunded', 'exchange_shipped'],
  refunded: [],
  exchange_shipped: [],
  rejected: [],
})

export const TERMINAL_RETURN_STATUSES: readonly ReturnStatus[] = Object.freeze(
  RETURN_STATUSES.filter((status) => RETURN_TRANSITIONS[status].length === 0),
)

/** The status at which units go back into stock. Exactly one, and it is after inspection. */
export const STOCK_RESTORED_AT: ReturnStatus = 'received'

export class IllegalReturnTransitionError extends Error {
  readonly from: ReturnStatus
  readonly to: ReturnStatus

  constructor(from: ReturnStatus, to: ReturnStatus) {
    super(`A return cannot move from ${from} to ${to}`)
    this.name = 'IllegalReturnTransitionError'
    this.from = from
    this.to = to
  }
}

export function isTerminalReturnStatus(status: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[status].length === 0
}

/**
 * Whether a transition is legal.
 *
 * A move to the same status is not legal, as on the other two machines: it is how a double-clicked
 * button refunds twice.
 */
export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from].includes(to)
}

export function assertReturnTransition(from: ReturnStatus, to: ReturnStatus): void {
  if (!canTransitionReturn(from, to)) throw new IllegalReturnTransitionError(from, to)
}

/** How each status reads to a customer. Staff see the raw value in the admin. */
export const RETURN_STATUS_LABELS: Readonly<Record<ReturnStatus, string>> = Object.freeze({
  requested: 'Requested',
  approved: 'Approved — we will arrange collection',
  picked_up: 'Collected',
  received: 'Received by us',
  refunded: 'Refunded',
  exchange_shipped: 'Replacement sent',
  rejected: 'Not approved',
})
