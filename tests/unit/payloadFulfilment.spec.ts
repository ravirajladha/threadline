/**
 * `payloadFulfilment` — permission and ordering, tested without a database.
 *
 * `fulfilment.spec.ts` already covers *which* actions an order allows; nothing here re-tests that.
 * What this file exists for is the two properties that only the port can get wrong:
 *
 * - **the role is re-checked**, before anything is read, so a `support_agent` who can view an order
 *   cannot ship it and cannot learn from the response whether an order id exists (OWASP A01/A07)
 * - **the decision runs on state read under the row lock**, so two staff members acting at once are
 *   ordered rather than both validating against the same stale status (OWASP A04)
 *
 * The fake serialises nothing by itself — see `support/fakePayload.ts`. Remove the lock from
 * `perform` and the concurrency test's two flows both read `packed` and both ship.
 */
import { describe, expect, it, vi } from 'vitest'

import { createPayloadFulfilment, fulfilmentOptionsFor, fulfilmentStateOf } from '@/lib/orders/payloadFulfilment'
import type { Order } from '@/payload-types'
import type { PayloadShipping } from '@/lib/shipping/payloadShipping'
import { createFakePayload, type FakeOrderRow } from './support/fakePayload'

const ORDER: FakeOrderRow = {
  id: 42,
  orderNumber: '260727-0007',
  status: 'confirmed',
  paymentStatus: 'paid',
  paymentMethod: 'razorpay',
  grandTotal: 249_900,
  awbCode: null,
}

/** A staff principal in the shape `req.user` actually arrives in. */
function staff(role: string, overrides: Record<string, unknown> = {}) {
  return { id: 9, collection: 'users', role, isActive: true, ...overrides }
}

const ORDER_MANAGER = staff('order_manager')
const SUPPORT_AGENT = staff('support_agent')

function fakeShipping(result: unknown = { ok: true, awbCode: 'AWB1', courier: 'stub', alreadyBooked: false }) {
  const bookShipment = vi.fn().mockResolvedValue(result)

  return {
    shipping: { bookShipment, applyTrackingEvent: vi.fn() } as unknown as PayloadShipping,
    bookShipment,
  }
}

function fulfilmentFor(order: FakeOrderRow = ORDER) {
  const { state, payload } = createFakePayload(order)
  const { shipping, bookShipment } = fakeShipping()

  return { state, bookShipment, fulfilment: createPayloadFulfilment({ payload, shipping }) }
}

describe('perform — permission', () => {
  it('lets an order manager pack a paid order', async () => {
    const { state, fulfilment } = fulfilmentFor()

    const outcome = await fulfilment.perform({ orderId: 42, action: 'pack', user: ORDER_MANAGER })

    expect(outcome).toMatchObject({ ok: true, action: 'pack', toStatus: 'packed' })
    expect(state.order.status).toBe('packed')
  })

  it('refuses a support agent', async () => {
    const { state, fulfilment } = fulfilmentFor()

    const outcome = await fulfilment.perform({ orderId: 42, action: 'pack', user: SUPPORT_AGENT })

    expect(outcome).toEqual({ ok: false, reason: 'forbidden' })
    expect(state.order.status).toBe('confirmed')
  })

  it('refuses an anonymous caller', async () => {
    const { fulfilment } = fulfilmentFor()

    expect(await fulfilment.perform({ orderId: 42, action: 'pack', user: null })).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('refuses a deactivated order manager', async () => {
    // The row survives because orders reference it; the permissions do not.
    const { fulfilment } = fulfilmentFor()

    const outcome = await fulfilment.perform({
      orderId: 42,
      action: 'pack',
      user: staff('order_manager', { isActive: false }),
    })

    expect(outcome).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('refuses a caller who supplies their own role on a customer principal', async () => {
    // The one attack this shape invites: a customer session with `role` set. `staffRoleOf` keys off
    // the auth collection, so the field is inert.
    const { fulfilment } = fulfilmentFor()

    const outcome = await fulfilment.perform({
      orderId: 42,
      action: 'pack',
      user: { id: 3, collection: 'customers', role: 'super_admin' },
    })

    expect(outcome).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('reads nothing at all before the permission check', async () => {
    // The refusal must not depend on the order, or the difference between forbidden and not-found
    // becomes a way to enumerate order ids.
    const { state, fulfilment } = fulfilmentFor()

    await fulfilment.perform({ orderId: 999, action: 'pack', user: SUPPORT_AGENT })

    expect(state.log).toEqual([])
  })

  it('logs the denial without naming the order', async () => {
    const { state, fulfilment } = fulfilmentFor()

    await fulfilment.perform({ orderId: 42, action: 'ship', user: SUPPORT_AGENT })

    const warning = state.logged.find((entry) => entry.level === 'warn')

    expect(warning).toBeDefined()
    expect(JSON.stringify(warning)).not.toContain(ORDER.orderNumber)
  })
})

describe('perform — refusals', () => {
  it('refuses to ship an order with no AWB, with the reason', async () => {
    const { state, fulfilment } = fulfilmentFor({ ...ORDER, status: 'packed' })

    const outcome = await fulfilment.perform({ orderId: 42, action: 'ship', user: ORDER_MANAGER })

    expect(outcome).toMatchObject({ ok: false, reason: 'refused', refusal: { reason: 'no_awb' } })
    expect(state.order.status).toBe('packed')
    expect(state.events).toHaveLength(0)
  })

  it('ships once an AWB exists', async () => {
    const { state, fulfilment } = fulfilmentFor({ ...ORDER, status: 'packed', awbCode: 'AWB123' })

    const outcome = await fulfilment.perform({ orderId: 42, action: 'ship', user: ORDER_MANAGER })

    expect(outcome).toMatchObject({ ok: true, toStatus: 'shipped' })
    expect(state.order.status).toBe('shipped')
  })

  it('treats a blank AWB as no AWB', async () => {
    const { fulfilment } = fulfilmentFor({ ...ORDER, status: 'packed', awbCode: '   ' })

    const outcome = await fulfilment.perform({ orderId: 42, action: 'ship', user: ORDER_MANAGER })

    expect(outcome).toMatchObject({ refusal: { reason: 'no_awb' } })
  })

  it('refuses to pack an unpaid prepaid order', async () => {
    const { fulfilment } = fulfilmentFor({ ...ORDER, paymentStatus: 'pending', status: 'pending' })

    const outcome = await fulfilment.perform({ orderId: 42, action: 'pack', user: ORDER_MANAGER })

    // `pending → packed` is not in the graph at all, so the most fundamental reason wins.
    expect(outcome).toMatchObject({ refusal: { reason: 'illegal_transition' } })
  })

  it('carries a human sentence with the refusal', async () => {
    const { fulfilment } = fulfilmentFor({ ...ORDER, status: 'packed' })

    const outcome = await fulfilment.perform({ orderId: 42, action: 'ship', user: ORDER_MANAGER })

    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok || outcome.reason !== 'refused') throw new Error('expected a refusal')
    expect(outcome.message).toContain('Book a courier first')
  })

  it('reports a missing order as not found', async () => {
    const { fulfilment } = fulfilmentFor()

    expect(await fulfilment.perform({ orderId: 4242, action: 'pack', user: ORDER_MANAGER })).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })
})

describe('perform — ordering and audit', () => {
  it('locks the row before reading the status it decides on', async () => {
    const { state, fulfilment } = fulfilmentFor()

    await fulfilment.perform({ orderId: 42, action: 'pack', user: ORDER_MANAGER })

    expect(state.log[0]).toBe('lock')
    expect(state.log.indexOf('lock')).toBeLessThan(state.log.indexOf('read:orders'))
  })

  it('writes one audit row naming the staff member who acted', async () => {
    const { state, fulfilment } = fulfilmentFor()

    await fulfilment.perform({ orderId: 42, action: 'pack', user: ORDER_MANAGER, note: 'Boxed' })

    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({
      fromStatus: 'confirmed',
      toStatus: 'packed',
      source: 'staff',
      actor: 9,
      note: 'Boxed',
    })
  })

  it('lets only one of two concurrent packs win', async () => {
    const { state, fulfilment } = fulfilmentFor()

    // Both read `confirmed` if they are not ordered, and both write an audit row for a move the
    // order only made once — a double-clicked button, not an attack.
    const [first, second] = await Promise.all([
      fulfilment.perform({ orderId: 42, action: 'pack', user: ORDER_MANAGER }),
      fulfilment.perform({ orderId: 42, action: 'pack', user: ORDER_MANAGER }),
    ])

    expect([first.ok, second.ok].sort()).toEqual([false, true])
    expect(state.events).toHaveLength(1)

    const refused = first.ok ? second : first
    expect(refused).toMatchObject({ reason: 'refused', refusal: { reason: 'illegal_transition' } })
  })
})

describe('bookShipment', () => {
  it('delegates to the shipping port for a permitted caller', async () => {
    const { fulfilment, bookShipment } = fulfilmentFor()

    const outcome = await fulfilment.bookShipment({ orderId: 42, user: ORDER_MANAGER })

    expect(outcome).toMatchObject({ ok: true, awbCode: 'AWB1' })
    expect(bookShipment).toHaveBeenCalledWith(42)
  })

  it('never reaches the courier for a caller without permission', async () => {
    // The cost of getting this wrong is not just an unauthorised write — booking a parcel spends
    // money with the courier.
    const { fulfilment, bookShipment } = fulfilmentFor()

    const outcome = await fulfilment.bookShipment({ orderId: 42, user: SUPPORT_AGENT })

    expect(outcome).toEqual({ ok: false, reason: 'forbidden' })
    expect(bookShipment).not.toHaveBeenCalled()
  })
})

describe('fulfilmentStateOf', () => {
  const doc = {
    status: 'shipped',
    paymentStatus: 'paid',
    paymentMethod: 'cod',
    awbCode: 'AWB9',
  } as unknown as Order

  it('reduces a document to what the decision needs', () => {
    expect(fulfilmentStateOf(doc)).toEqual({
      status: 'shipped',
      paymentStatus: 'paid',
      paymentMethod: 'cod',
      awbCode: 'AWB9',
    })
  })

  it('normalises an absent AWB to null however Payload spelled it', () => {
    expect(fulfilmentStateOf({ ...doc, awbCode: undefined } as unknown as Order).awbCode).toBeNull()
    expect(fulfilmentStateOf({ ...doc, awbCode: '' } as unknown as Order).awbCode).toBeNull()
  })

  it('decides every action for a document, refusals included', () => {
    // The admin renders all three, so a disabled button can explain itself.
    expect(fulfilmentOptionsFor(doc)).toHaveLength(3)
    expect(fulfilmentOptionsFor(doc).filter((option) => option.allowed)).toHaveLength(1)
  })
})
