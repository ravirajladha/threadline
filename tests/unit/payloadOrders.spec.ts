/**
 * `payloadOrders` — the concurrency guarantees, tested without a database.
 *
 * The pure decision in `paymentApply.ts` is covered by `paymentApply.spec.ts`. What that cannot
 * reach is the part which is only correct because of *when* things happen: a payment provider
 * retrying an event delivers it twice, and the duplicate check only works if the two deliveries are
 * ordered. So the fake here models the one piece of Postgres behaviour the guarantee rests on —
 * **`SELECT … FOR UPDATE` holds the row until the transaction ends** — and the tests assert that a
 * concurrent replay changes nothing.
 *
 * Why that makes these tests worth having rather than a restatement of the implementation: the fake
 * serialises nothing by itself. It blocks a second caller only if the code under test actually asks
 * for the lock. Delete the `lockOrderByNumber` call and the two flows interleave, both read a trail
 * without the event id, and both apply it — which is exactly the bug, and the assertions below fail.
 */
import { describe, expect, it } from 'vitest'

import { createPayloadOrders } from '@/lib/orders/payloadOrders'
import type { PaymentEvent } from '@/lib/payments/types'
import type { Payload } from 'payload'

/**
 * The text and the bound parameters of a drizzle `sql` template.
 *
 * A text chunk is an object whose `value` is an array of strings; anything else in the chunk list
 * is a bound parameter. Splitting them is what lets a test assert the order number crossed as a
 * parameter rather than as concatenated text (OWASP A03).
 */
function splitSql(query: unknown): { text: string; params: unknown[] } {
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
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface FakeOrderRow {
  id: number
  orderNumber: string
  status: string
  paymentStatus: string
  grandTotal: number
}

/**
 * A Payload double with a row lock.
 *
 * Every operation yields first, so interleaving is real. `FOR UPDATE` takes a mutex that is only
 * released by commit or rollback — the property the fix depends on.
 *
 * Writes become visible to other flows immediately rather than at commit. That is weaker than
 * Postgres, and deliberately so: it can only make an unlocked implementation look *better* than it
 * is, never worse, so a passing test is not an artefact of the fake.
 */
function createFakePayload(order: FakeOrderRow) {
  const state = {
    order: { ...order },
    events: [] as Array<{ order: number; note?: string; toStatus: string }>,
    movements: [] as Array<{ variant: number; qty: number }>,
    log: [] as string[],
    statements: [] as Array<{ text: string; params: unknown[] }>,
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

  const payload = {
    db,
    async findByID({ collection }: { collection: string }): Promise<unknown> {
      await tick()
      state.log.push(`read:${collection}`)

      return collection === 'orders' ? { ...state.order } : null
    },
    async find({ collection }: { collection: string }): Promise<{ docs: unknown[] }> {
      await tick()
      state.log.push(`read:${collection}`)

      if (collection === 'orderEvents') return { docs: state.events.map((row) => ({ ...row })) }
      if (collection === 'orderItems') return { docs: [{ variant: 7, qty: 2 }] }
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

      if (collection === 'orderEvents') {
        state.events.push(data as unknown as { order: number; note?: string; toStatus: string })
      }
      if (collection === 'stockMovements') {
        state.movements.push(data as unknown as { variant: number; qty: number })
      }

      return { id: state.events.length }
    },
    async count(): Promise<{ totalDocs: number }> {
      return { totalDocs: 0 }
    },
  }

  return { state, payload: payload as unknown as Payload }
}

const ORDER: FakeOrderRow = {
  id: 42,
  orderNumber: '260727-0007',
  status: 'pending',
  paymentStatus: 'pending',
  grandTotal: 249_900,
}

/** The event id must look like a provider's, because `processedEventIdsFrom` recovers it by pattern. */
function captureEvent(id = 'stub_evt_abc123'): PaymentEvent {
  return {
    id,
    type: 'payment.captured',
    gatewayOrderId: 'stub_order_1',
    gatewayPaymentId: 'stub_pay_1',
    amountPaise: ORDER.grandTotal,
    reference: ORDER.orderNumber,
    occurredAt: '2026-07-27T12:00:00.000Z',
  }
}

describe('applyPaymentEvent — locking', () => {
  it('locks the order row before reading the state it decides on', async () => {
    const { state, payload } = createFakePayload(ORDER)

    await createPayloadOrders({ payload }).applyPaymentEvent(captureEvent())

    // The ordering *is* the guarantee: a read of the audit trail before the lock is a read that
    // another transaction can invalidate before this one writes.
    expect(state.log[0]).toBe('lock')
    expect(state.log.indexOf('lock')).toBeLessThan(state.log.indexOf('read:orderEvents'))
  })

  it('binds the order number as a parameter rather than building the statement from it', async () => {
    const { state, payload } = createFakePayload(ORDER)

    await createPayloadOrders({ payload }).applyPaymentEvent(captureEvent())

    const lock = state.statements.find((statement) => statement.text.includes('FOR UPDATE'))

    expect(lock).toBeDefined()
    expect(lock?.params).toContain(ORDER.orderNumber)
    // The value must not appear in the SQL text — that is the difference between a bound parameter
    // and string concatenation, and it is the whole of the A03 claim for this file.
    expect(lock?.text).not.toContain(ORDER.orderNumber)
  })

  it('applies a captured event once and confirms the order', async () => {
    const { state, payload } = createFakePayload(ORDER)

    const decision = await createPayloadOrders({ payload }).applyPaymentEvent(captureEvent())

    expect(decision.action).toBe('apply')
    expect(state.order.paymentStatus).toBe('paid')
    expect(state.events).toHaveLength(1)
    // Stock is committed as a sale, exactly once.
    expect(state.movements).toHaveLength(1)
  })

  it('does not apply the same event twice when two deliveries race', async () => {
    const { state, payload } = createFakePayload(ORDER)
    const orders = createPayloadOrders({ payload })
    const event = captureEvent()

    // Both in flight at once, which is what a provider's retry alongside a slow first delivery is.
    const [first, second] = await Promise.all([
      orders.applyPaymentEvent(event),
      orders.applyPaymentEvent(event),
    ])

    const actions = [first.action, second.action].sort()

    expect(actions).toEqual(['apply', 'ignore'])

    const ignored = first.action === 'ignore' ? first : second
    expect(ignored).toMatchObject({ action: 'ignore', reason: 'duplicate_event' })

    // The properties that actually matter: one audit row, and the stock sold once.
    expect(state.events).toHaveLength(1)
    expect(state.movements).toHaveLength(1)
  })

  it('ignores an event whose reference matches no order, without reading anything else', async () => {
    const { state, payload } = createFakePayload(ORDER)

    const decision = await createPayloadOrders({ payload }).applyPaymentEvent({
      ...captureEvent(),
      reference: '260727-9999',
    })

    expect(decision).toMatchObject({ action: 'ignore', reason: 'reference_mismatch' })
    expect(state.log).toEqual(['lock'])
    expect(state.events).toHaveLength(0)
  })
})

describe('transition — locking', () => {
  it('locks the row before reading the status it validates against', async () => {
    const { state, payload } = createFakePayload(ORDER)

    await createPayloadOrders({ payload }).transition({
      orderId: ORDER.id,
      toStatus: 'confirmed',
      source: 'staff',
    })

    expect(state.log[0]).toBe('lock')
    expect(state.log.indexOf('lock')).toBeLessThan(state.log.indexOf('read:orders'))
    expect(state.order.status).toBe('confirmed')
  })

  it('lets only one of two concurrent transitions win, and refuses the illegal second', async () => {
    const { state, payload } = createFakePayload(ORDER)
    const orders = createPayloadOrders({ payload })

    // Both read `pending` if they are not ordered. Only one may take the order to `confirmed`;
    // the other is validating against a status the order has already left.
    const results = await Promise.allSettled([
      orders.transition({ orderId: ORDER.id, toStatus: 'confirmed', source: 'staff' }),
      orders.transition({ orderId: ORDER.id, toStatus: 'confirmed', source: 'staff' }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')

    expect(fulfilled).toHaveLength(1)
    expect(state.events).toHaveLength(1)
  })
})
