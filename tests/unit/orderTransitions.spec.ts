import { describe, expect, it } from 'vitest'

import {
  assertPaymentTransition,
  assertTransition,
  canTransition,
  canTransitionPayment,
  IllegalPaymentTransitionError,
  IllegalTransitionError,
  isCancellable,
  isTerminalStatus,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  releasesStock,
  statusAfterPayment,
  statusAfterPaymentFailure,
  TERMINAL_ORDER_STATUSES,
} from '@/lib/orders/transitions'
import { ORDER_STATUSES, PAYMENT_STATUSES, type OrderStatus } from '@/types'

describe('the order status graph', () => {
  it('covers every declared status', () => {
    // A status in the union with no entry here would throw on the first lookup.
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort())
  })

  it('only ever points at real statuses', () => {
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(ORDER_STATUSES, `${from} → ${to}`).toContain(to)
      }
    }
  })

  it('walks the happy path end to end', () => {
    const path: OrderStatus[] = ['pending', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered']

    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]
      const to = path[index + 1]
      expect(from).toBeDefined()
      expect(to).toBeDefined()
      if (from && to) expect(canTransition(from, to), `${from} → ${to}`).toBe(true)
    }
  })

  it('lets a courier skip the out-for-delivery scan', () => {
    // Plenty of couriers never send it, and refusing the delivery would strand those orders.
    expect(canTransition('shipped', 'delivered')).toBe(true)
  })

  it('has no path back up the happy path', () => {
    expect(canTransition('delivered', 'shipped')).toBe(false)
    expect(canTransition('shipped', 'packed')).toBe(false)
    expect(canTransition('confirmed', 'pending')).toBe(false)
  })

  it('refuses a transition to the same status', () => {
    // Not harmless: it is how a replayed webhook writes a second audit row and fires the
    // delivery notification twice.
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status), status).toBe(false)
    }
  })

  it('cannot leave a terminal status', () => {
    expect(TERMINAL_ORDER_STATUSES).toEqual(expect.arrayContaining(['refunded', 'payment_failed']))

    for (const status of TERMINAL_ORDER_STATUSES) {
      expect(isTerminalStatus(status)).toBe(true)

      for (const to of ORDER_STATUSES) {
        expect(canTransition(status, to), `${status} → ${to}`).toBe(false)
      }
    }
  })

  it('does not revive a failed payment as an order', () => {
    // A retry is a new order, so the failed attempt stays on the record.
    expect(canTransition('payment_failed', 'confirmed')).toBe(false)
    expect(canTransition('payment_failed', 'pending')).toBe(false)
  })

  it('can refund a cancelled, returned or returned-to-origin order', () => {
    expect(canTransition('cancelled', 'refunded')).toBe(true)
    expect(canTransition('returned', 'refunded')).toBe(true)
    expect(canTransition('rto', 'refunded')).toBe(true)
  })

  it('will not cancel a parcel that has already gone out', () => {
    expect(canTransition('shipped', 'cancelled')).toBe(false)
    expect(canTransition('out_for_delivery', 'cancelled')).toBe(false)
    expect(canTransition('delivered', 'cancelled')).toBe(false)
  })
})

describe('assertTransition', () => {
  it('passes a legal move silently', () => {
    expect(() => assertTransition('pending', 'confirmed')).not.toThrow()
  })

  it('throws on every illegal move', () => {
    expect(() => assertTransition('delivered', 'pending')).toThrow(IllegalTransitionError)
  })

  it('names both ends on the error, for the log', () => {
    try {
      assertTransition('delivered', 'pending')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError)
      if (error instanceof IllegalTransitionError) {
        expect(error.from).toBe('delivered')
        expect(error.to).toBe('pending')
        expect(error.message).toContain('delivered')
      }
    }
  })
})

describe('isCancellable and releasesStock', () => {
  it('allows cancelling only before dispatch', () => {
    expect(isCancellable('pending')).toBe(true)
    expect(isCancellable('confirmed')).toBe(true)
    expect(isCancellable('packed')).toBe(true)
    expect(isCancellable('shipped')).toBe(false)
    expect(isCancellable('delivered')).toBe(false)
  })

  it('returns stock when an undispatched order is cancelled', () => {
    expect(releasesStock('confirmed', 'cancelled')).toBe(true)
    expect(releasesStock('packed', 'cancelled')).toBe(true)
  })

  it('leaves a return or an RTO to the returns flow, where goods are inspected', () => {
    expect(releasesStock('delivered', 'returned')).toBe(false)
    expect(releasesStock('shipped', 'rto')).toBe(false)
  })
})

describe('the payment status graph', () => {
  it('covers every declared payment status', () => {
    expect(Object.keys(PAYMENT_TRANSITIONS).sort()).toEqual([...PAYMENT_STATUSES].sort())
  })

  it('follows pending → paid → refunded', () => {
    expect(canTransitionPayment('pending', 'paid')).toBe(true)
    expect(canTransitionPayment('paid', 'refunded')).toBe(true)
  })

  it('allows a retry after a failure', () => {
    expect(canTransitionPayment('failed', 'paid')).toBe(true)
  })

  it('never unpays a paid order', () => {
    expect(canTransitionPayment('paid', 'pending')).toBe(false)
    expect(canTransitionPayment('paid', 'failed')).toBe(false)
  })

  it('cannot leave refunded', () => {
    for (const to of PAYMENT_STATUSES) {
      expect(canTransitionPayment('refunded', to), to).toBe(false)
    }
  })

  it('throws on an illegal payment move', () => {
    expect(() => assertPaymentTransition('refunded', 'paid')).toThrow(IllegalPaymentTransitionError)
    expect(() => assertPaymentTransition('pending', 'paid')).not.toThrow()
  })
})

describe('statusAfterPayment', () => {
  it('confirms a pending order', () => {
    expect(statusAfterPayment('pending')).toBe('confirmed')
  })

  it('changes nothing for an order that has moved on', () => {
    // A late or replayed capture must not drag a shipped order backwards.
    for (const status of ORDER_STATUSES.filter((s) => s !== 'pending')) {
      expect(statusAfterPayment(status), status).toBeNull()
    }
  })

  it('fails only a pending order', () => {
    expect(statusAfterPaymentFailure('pending')).toBe('payment_failed')
    expect(statusAfterPaymentFailure('confirmed')).toBeNull()
  })
})
