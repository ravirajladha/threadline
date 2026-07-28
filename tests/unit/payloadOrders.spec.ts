/**
 * `payloadOrders` — the concurrency guarantees, tested without a database.
 *
 * The pure decision in `paymentApply.ts` is covered by `paymentApply.spec.ts`. What that cannot
 * reach is the part which is only correct because of *when* things happen: a payment provider
 * retrying an event delivers it twice, and the duplicate check only works if the two deliveries are
 * ordered. So the fake in `support/fakePayload.ts` models the one piece of Postgres behaviour the
 * guarantee rests on — **`SELECT … FOR UPDATE` holds the row until the transaction ends** — and the
 * tests assert that a concurrent replay changes nothing.
 *
 * Why that makes these tests worth having rather than a restatement of the implementation: the fake
 * serialises nothing by itself. It blocks a second caller only if the code under test actually asks
 * for the lock. Delete the `lockOrderByNumber` call and the two flows interleave, both read a trail
 * without the event id, and both apply it — which is exactly the bug, and the assertions below fail.
 */
import { describe, expect, it, vi } from 'vitest'

import { createPayloadOrders } from '@/lib/orders/payloadOrders'
import type { Dispatcher } from '@/lib/notify/dispatcher'
import type { PaymentEvent } from '@/lib/payments/types'
import { createFakePayload, type FakeOrderRow } from './support/fakePayload'

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

describe('applyPaymentEvent — notification', () => {
  it('sends the confirmation a customer actually waits for', async () => {
    // The gap this closes: `applyPaymentEvent` writes status itself rather than calling
    // `transition`, so hooking only `transition` would have left `order.confirmed` — the single
    // most expected email in the whole flow — as the one that never arrives.
    const { payload } = createFakePayload({ ...ORDER, email: 'asha@example.com' })
    const dispatch = vi.fn().mockResolvedValue({ status: 'sent' })

    await createPayloadOrders({ payload, notify: { dispatch } as unknown as Dispatcher }).applyPaymentEvent(
      captureEvent(),
    )

    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      event: 'order.confirmed',
      recipient: { address: 'asha@example.com' },
    })
  })

  it('does not announce a failed payment', async () => {
    // The customer is looking at the failure page. A second telling is noise at the worst moment.
    const { payload } = createFakePayload({ ...ORDER, email: 'asha@example.com' })
    const dispatch = vi.fn().mockResolvedValue({ status: 'sent' })

    await createPayloadOrders({ payload, notify: { dispatch } as unknown as Dispatcher }).applyPaymentEvent({
      ...captureEvent(),
      type: 'payment.failed',
    })

    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('transition — notification', () => {
  /** A dispatcher double. The port is given one explicitly, so no channel is ever built. */
  function fakeNotify() {
    const dispatch = vi.fn().mockResolvedValue({ status: 'sent', event: 'order.shipped', channel: 'email', providerId: 'p1' })

    return { notify: { dispatch } as unknown as Dispatcher, dispatch }
  }

  it('tells the customer about a status the customer is waiting on', async () => {
    // The structural claim of J6: `transition` is the only path a status can take, so hooking it
    // here means coverage does not depend on every caller remembering.
    const { payload } = createFakePayload({ ...ORDER, email: 'asha@example.com', status: 'packed' })
    const { notify, dispatch } = fakeNotify()

    await createPayloadOrders({ payload, notify }).transition({
      orderId: ORDER.id,
      toStatus: 'shipped',
      source: 'staff',
    })

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      event: 'order.shipped',
      recipient: { address: 'asha@example.com' },
      subject: `order:${ORDER.orderNumber}:shipped`,
    })
  })

  it('says nothing about an internal step', async () => {
    const { payload } = createFakePayload({ ...ORDER, email: 'asha@example.com' })
    const { notify, dispatch } = fakeNotify()

    await createPayloadOrders({ payload, notify }).transition({
      orderId: ORDER.id,
      toStatus: 'confirmed',
      source: 'webhook',
    })

    // `confirmed` does notify; `packed` is the silent one, and this proves the map is consulted
    // rather than every transition being announced.
    expect(dispatch).toHaveBeenCalledOnce()

    const second = fakeNotify()
    const { payload: other } = createFakePayload({
      ...ORDER,
      email: 'asha@example.com',
      status: 'confirmed',
    })

    await createPayloadOrders({ payload: other, notify: second.notify }).transition({
      orderId: ORDER.id,
      toStatus: 'packed',
      source: 'staff',
    })

    expect(second.dispatch).not.toHaveBeenCalled()
  })

  it('joins the caller’s transaction, so a rolled-back order takes its notification with it', async () => {
    const { payload } = createFakePayload({ ...ORDER, email: 'asha@example.com', status: 'packed' })
    const { notify, dispatch } = fakeNotify()

    await createPayloadOrders({ payload, notify }).transition({
      orderId: ORDER.id,
      toStatus: 'shipped',
      source: 'staff',
    })

    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ transactionID: expect.anything() })
  })

  it('has nobody to tell when the order carries no address', async () => {
    const { payload } = createFakePayload({ ...ORDER, status: 'packed' })
    const { notify, dispatch } = fakeNotify()

    await createPayloadOrders({ payload, notify }).transition({
      orderId: ORDER.id,
      toStatus: 'shipped',
      source: 'staff',
    })

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('completes the transition even when the dispatcher throws', async () => {
    // The rule: a notification failure never blocks the order flow. `dispatch` promises not to
    // throw — this is the belt for the day something upstream of it does.
    const { state, payload } = createFakePayload({ ...ORDER, email: 'asha@example.com', status: 'packed' })
    const notify = { dispatch: vi.fn().mockRejectedValue(new Error('provider exploded')) } as unknown as Dispatcher

    await createPayloadOrders({ payload, notify }).transition({
      orderId: ORDER.id,
      toStatus: 'shipped',
      source: 'staff',
    })

    expect(state.order.status).toBe('shipped')
    expect(state.events).toHaveLength(1)
  })

  it('sends nothing at all when notifications are turned off', async () => {
    const { state, payload } = createFakePayload({ ...ORDER, email: 'asha@example.com', status: 'packed' })

    await createPayloadOrders({ payload, notify: null }).transition({
      orderId: ORDER.id,
      toStatus: 'shipped',
      source: 'staff',
    })

    expect(state.order.status).toBe('shipped')
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
