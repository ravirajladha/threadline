/**
 * A Payload double with a real row lock.
 *
 * Shared by every spec that tests a port whose correctness depends on *when* things happen rather
 * than on what they compute — `payloadOrders` (a replayed payment event), `payloadFulfilment` (two
 * staff members clicking Ship at once). The pure decisions those ports call are tested elsewhere;
 * what cannot be reached without a database, or without this, is the ordering.
 *
 * The fake models exactly one piece of Postgres behaviour: **`SELECT … FOR UPDATE` holds the row
 * until the transaction ends.** Everything else is a recorder.
 *
 * Two properties make these tests worth having rather than a restatement of the implementation:
 *
 * - **It serialises nothing by itself.** A second caller blocks only if the code under test actually
 *   asks for the lock. Delete the `lockOrderById` call and the flows interleave and both apply —
 *   which is the bug, and the assertions fail.
 * - **Writes become visible immediately rather than at commit.** That is weaker than Postgres, and
 *   deliberately so: it can only make an unlocked implementation look *better* than it is, never
 *   worse, so a passing test is not an artefact of the fake.
 */
import type { Payload } from 'payload'

/**
 * The text and the bound parameters of a drizzle `sql` template.
 *
 * A text chunk is an object whose `value` is an array of strings; anything else in the chunk list
 * is a bound parameter. Splitting them is what lets a test assert the order number crossed as a
 * parameter rather than as concatenated text (OWASP A03).
 */
export function splitSql(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? []
  const text: string[] = []
  const params: unknown[] = []

  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown } | null)?.value

    if (Array.isArray(value)) text.push(value.join(''))
    else params.push((chunk as { value?: unknown } | null)?.value ?? chunk)
  }

  // Joined with the placeholder a parameter would occupy, so the shape of the statement is visible.
  return { text: text.join(' ? '), params }
}

/** Yield to the event loop, so two concurrent flows genuinely interleave rather than run to completion. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export interface FakeOrderRow {
  id: number
  orderNumber: string
  status: string
  paymentStatus: string
  grandTotal: number
  paymentMethod?: string
  awbCode?: string | null
  courier?: string | null
  shiprocketOrderId?: string | null
  shippingAddress?: { pincode?: string } | null
}

export interface FakeEventRow {
  order: number
  fromStatus?: string
  toStatus: string
  source?: string
  note?: string
  actor?: number | string
}

export interface FakePayloadOptions {
  /** The lines `orderItems` reads back. Defaults to one line, which is all most tests need. */
  orderItems?: Array<Record<string, unknown>>
}

export interface FakePayloadState {
  order: FakeOrderRow
  events: FakeEventRow[]
  movements: Array<Record<string, unknown>>
  /** Every operation, in order — the sequence assertions read this. */
  log: string[]
  statements: Array<{ text: string; params: unknown[] }>
  /** What the port logged, so an audit-line claim can be asserted rather than assumed. */
  logged: Array<{ level: 'info' | 'warn' | 'error'; payload: unknown; message: unknown }>
}

export function createFakePayload(
  order: FakeOrderRow,
  options: FakePayloadOptions = {},
): { state: FakePayloadState; payload: Payload } {
  const { orderItems = [{ variant: 7, qty: 2, sku: 'TL-SKU-1' }] } = options

  const state: FakePayloadState = {
    order: { ...order },
    events: [],
    movements: [],
    log: [],
    statements: [],
    logged: [],
  }

  let nextTx = 0
  let lockedBy: string | null = null
  let waiters: Array<() => void> = []

  async function acquire(txId: string): Promise<void> {
    // A loop, not an `if`: being woken means the lock is free to *contend* for, not that it is ours.
    while (lockedBy !== null && lockedBy !== txId) {
      await new Promise<void>((resolve) => waiters.push(resolve))
    }

    lockedBy = txId
  }

  function release(txId: string): void {
    if (lockedBy !== txId) return

    lockedBy = null
    const woken = waiters
    waiters = []
    woken.forEach((resolve) => resolve())
  }

  const sessions: Record<string, { db: { execute(query: unknown): Promise<unknown> } }> = {}

  function executeFor(txId: string | null) {
    return async (query: unknown): Promise<unknown> => {
      await tick()

      const parsed = splitSql(query)
      state.statements.push(parsed)

      if (parsed.text.includes('FOR UPDATE')) {
        state.log.push('lock')
        if (txId !== null) await acquire(txId)

        const matches =
          parsed.params.includes(state.order.orderNumber) || parsed.params.includes(state.order.id)

        return { rows: matches ? [{ id: state.order.id }] : [] }
      }

      state.log.push('sql')

      return { rowCount: 1 }
    }
  }

  const db = {
    async beginTransaction(): Promise<string> {
      nextTx += 1
      const txId = String(nextTx)
      sessions[txId] = { db: { execute: executeFor(txId) } }

      return txId
    },
    async commitTransaction(txId: string): Promise<void> {
      release(txId)
    },
    async rollbackTransaction(txId: string): Promise<void> {
      release(txId)
    },
    sessions,
    drizzle: { execute: executeFor(null) },
  }

  function record(level: 'info' | 'warn' | 'error') {
    return (payload: unknown, message?: unknown): void => {
      state.logged.push({ level, payload, message })
    }
  }

  const payload = {
    db,
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
    async findByID({ collection, id }: { collection: string; id: number | string }): Promise<unknown> {
      await tick()
      state.log.push(`read:${collection}`)

      // Id-sensitive, so a spec can exercise the not-found path by asking for one that is not there.
      if (collection !== 'orders') return null

      return Number(id) === state.order.id ? { ...state.order } : null
    },
    async find({ collection }: { collection: string }): Promise<{ docs: unknown[] }> {
      await tick()
      state.log.push(`read:${collection}`)

      if (collection === 'orderEvents') return { docs: state.events.map((row) => ({ ...row })) }
      if (collection === 'orderItems') return { docs: orderItems.map((row) => ({ ...row })) }
      if (collection === 'orders') return { docs: [{ ...state.order }] }

      return { docs: [] }
    },
    async update({ collection, data }: { collection: string; data: Record<string, unknown> }): Promise<unknown> {
      await tick()
      state.log.push(`write:${collection}`)

      if (collection === 'orders') Object.assign(state.order, data)

      return { ...state.order }
    },
    async create({ collection, data }: { collection: string; data: Record<string, unknown> }): Promise<unknown> {
      await tick()
      state.log.push(`write:${collection}`)

      if (collection === 'orderEvents') state.events.push(data as unknown as FakeEventRow)
      if (collection === 'stockMovements') state.movements.push(data)

      return { id: state.events.length }
    },
    async count(): Promise<{ totalDocs: number }> {
      return { totalDocs: 0 }
    },
  }

  return { state, payload: payload as unknown as Payload }
}
