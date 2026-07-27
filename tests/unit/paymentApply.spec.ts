import { describe, expect, it } from 'vitest'

import {
  decidePaymentApply,
  eventNote,
  PAYMENT_IGNORE_REASONS,
  processedEventIdsFrom,
  stockActionFor,
  type OrderPaymentState,
} from '@/lib/orders/paymentApply'
import type { PaymentEvent, PaymentEventType } from '@/lib/payments/types'
import { ORDER_STATUSES } from '@/types'

function order(overrides: Partial<OrderPaymentState> = {}): OrderPaymentState {
  return {
    orderNumber: 'TL-260727-0001',
    status: 'pending',
    paymentStatus: 'pending',
    grandTotal: 136400,
    processedEventIds: [],
    ...overrides,
  }
}

function event(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    id: 'stub_evt_1',
    type: 'payment.captured',
    gatewayOrderId: 'stub_order_1',
    gatewayPaymentId: 'stub_pay_1',
    amountPaise: 136400,
    reference: 'TL-260727-0001',
    occurredAt: '2026-07-27T09:00:00.000Z',
    ...overrides,
  }
}

describe('decidePaymentApply — a successful capture', () => {
  it('confirms a pending order', () => {
    expect(decidePaymentApply({ order: order(), event: event() })).toEqual({
      action: 'apply',
      toStatus: 'confirmed',
      toPaymentStatus: 'paid',
      note: 'payment.captured stub_evt_1',
    })
  })

  it('commits the reserved stock', () => {
    const decision = decidePaymentApply({ order: order(), event: event() })

    expect(stockActionFor(decision)).toBe('commit')
  })
})

describe('decidePaymentApply — idempotency', () => {
  it('ignores an event id it has already applied', () => {
    // Providers retry. Without this the order is confirmed twice, the stock committed twice
    // and the confirmation email sent twice.
    const decision = decidePaymentApply({
      order: order({ processedEventIds: ['stub_evt_1'] }),
      event: event({ id: 'stub_evt_1' }),
    })

    expect(decision).toEqual({ action: 'ignore', reason: 'duplicate_event' })
  })

  it('applies a genuinely different event on the same order', () => {
    const decision = decidePaymentApply({
      order: order({ processedEventIds: ['stub_evt_0'] }),
      event: event({ id: 'stub_evt_1' }),
    })

    expect(decision.action).toBe('apply')
  })

  it('ignores a second capture even when the id is new', () => {
    // A different id for the same payment must not pay the order twice.
    const decision = decidePaymentApply({
      order: order({ status: 'confirmed', paymentStatus: 'paid' }),
      event: event({ id: 'stub_evt_2' }),
    })

    expect(decision).toEqual({ action: 'ignore', reason: 'already_paid' })
  })

  it('does nothing to stock for an ignored event', () => {
    const decision = decidePaymentApply({
      order: order({ processedEventIds: ['stub_evt_1'] }),
      event: event(),
    })

    expect(stockActionFor(decision)).toBe('none')
  })
})

describe('decidePaymentApply — the amount', () => {
  it('refuses a capture for less than the order costs', () => {
    // The gateway really did take this amount, so no later reconciliation would catch it.
    const decision = decidePaymentApply({ order: order(), event: event({ amountPaise: 100 }) })

    expect(decision).toEqual({ action: 'ignore', reason: 'amount_mismatch' })
  })

  it('refuses a capture for more than the order costs', () => {
    const decision = decidePaymentApply({ order: order(), event: event({ amountPaise: 999999 }) })

    expect(decision).toEqual({ action: 'ignore', reason: 'amount_mismatch' })
  })

  it('requires an exact match, to the paise', () => {
    expect(
      decidePaymentApply({ order: order({ grandTotal: 136400 }), event: event({ amountPaise: 136399 }) }).action,
    ).toBe('ignore')
  })
})

describe('decidePaymentApply — the reference', () => {
  it('refuses an event for a different order', () => {
    const decision = decidePaymentApply({ order: order(), event: event({ reference: 'TL-260727-9999' }) })

    expect(decision).toEqual({ action: 'ignore', reason: 'reference_mismatch' })
  })

  it('checks the reference before anything else', () => {
    // An event aimed at another order must not even be considered a duplicate of this one.
    const decision = decidePaymentApply({
      order: order({ processedEventIds: ['stub_evt_1'] }),
      event: event({ reference: 'TL-OTHER' }),
    })

    expect(decision).toEqual({ action: 'ignore', reason: 'reference_mismatch' })
  })
})

describe('decidePaymentApply — a late or out-of-order event', () => {
  it('changes nothing on a cancelled order', () => {
    const decision = decidePaymentApply({
      order: order({ status: 'cancelled' }),
      event: event(),
    })

    expect(decision).toEqual({ action: 'ignore', reason: 'order_not_pending' })
  })

  it('changes nothing on an order that has already shipped', () => {
    const decision = decidePaymentApply({
      order: order({ status: 'shipped', paymentStatus: 'paid' }),
      event: event(),
    })

    expect(decision.action).toBe('ignore')
  })

  it('never drags an order backwards, whatever state it is in', () => {
    for (const status of ORDER_STATUSES.filter((s) => s !== 'pending')) {
      const decision = decidePaymentApply({ order: order({ status }), event: event() })

      expect(decision.action, status).toBe('ignore')
    }
  })
})

describe('decidePaymentApply — a failure', () => {
  it('marks a pending order as failed', () => {
    const decision = decidePaymentApply({ order: order(), event: event({ type: 'payment.failed' }) })

    expect(decision).toMatchObject({ action: 'apply', toStatus: 'payment_failed', toPaymentStatus: 'failed' })
  })

  it('releases the reserved stock', () => {
    const decision = decidePaymentApply({ order: order(), event: event({ type: 'payment.failed' }) })

    expect(stockActionFor(decision)).toBe('release')
  })

  it('does not fail an order that is already paid', () => {
    // A failure callback arriving after a successful capture is the provider being noisy,
    // not a reason to unpay a paid order.
    const decision = decidePaymentApply({
      order: order({ status: 'confirmed', paymentStatus: 'paid' }),
      event: event({ type: 'payment.failed' }),
    })

    expect(decision).toEqual({ action: 'ignore', reason: 'already_paid' })
  })

  it('ignores a failure amount entirely', () => {
    // Nothing was taken, so there is no figure to reconcile.
    const decision = decidePaymentApply({
      order: order(),
      event: event({ type: 'payment.failed', amountPaise: 1 }),
    })

    expect(decision.action).toBe('apply')
  })
})

describe('decidePaymentApply — a refund', () => {
  it('refunds a paid, cancelled order', () => {
    const decision = decidePaymentApply({
      order: order({ status: 'cancelled', paymentStatus: 'paid' }),
      event: event({ type: 'refund.processed' }),
    })

    expect(decision).toMatchObject({ action: 'apply', toStatus: 'refunded', toPaymentStatus: 'refunded' })
  })

  it('refuses a refund on an order that was never paid', () => {
    const decision = decidePaymentApply({ order: order(), event: event({ type: 'refund.processed' }) })

    expect(decision).toEqual({ action: 'ignore', reason: 'not_refundable' })
  })

  it('refuses a second refund', () => {
    const decision = decidePaymentApply({
      order: order({ status: 'refunded', paymentStatus: 'refunded' }),
      event: event({ type: 'refund.processed', id: 'stub_evt_2' }),
    })

    expect(decision).toEqual({ action: 'ignore', reason: 'not_refundable' })
  })

  it('does not touch stock', () => {
    const decision = decidePaymentApply({
      order: order({ status: 'cancelled', paymentStatus: 'paid' }),
      event: event({ type: 'refund.processed' }),
    })

    expect(stockActionFor(decision)).toBe('none')
  })
})

describe('decidePaymentApply — every combination has an answer', () => {
  it('never returns undefined for any status and event type', () => {
    const types: PaymentEventType[] = ['payment.captured', 'payment.failed', 'refund.processed']

    for (const status of ORDER_STATUSES) {
      for (const paymentStatus of ['pending', 'paid', 'failed', 'refunded'] as const) {
        for (const type of types) {
          const decision = decidePaymentApply({ order: order({ status, paymentStatus }), event: event({ type }) })

          expect(decision.action, `${status}/${paymentStatus}/${type}`).toMatch(/^(apply|ignore)$/)
          if (decision.action === 'ignore') {
            expect(PAYMENT_IGNORE_REASONS).toContain(decision.reason)
          }
        }
      }
    }
  })
})

describe('the audit trail', () => {
  it('writes a note carrying the event id and nothing else', () => {
    // The trail is what the next replay is checked against, so the id has to survive — and
    // nothing about the customer may (OWASP A09).
    expect(eventNote(event())).toBe('payment.captured stub_evt_1')
    expect(eventNote(event())).not.toContain('136400')
  })

  it('recovers event ids from the notes it wrote', () => {
    const notes = [eventNote(event({ id: 'stub_evt_1' })), eventNote(event({ id: 'stub_evt_2' }))]

    expect(processedEventIdsFrom(notes)).toEqual(['stub_evt_1', 'stub_evt_2'])
  })

  it('skips notes with no event id in them', () => {
    expect(processedEventIdsFrom(['packed by warehouse', null, undefined])).toEqual([])
  })

  it('round-trips through the decision it feeds', () => {
    const first = event({ id: 'stub_evt_7' })
    const decision = decidePaymentApply({ order: order(), event: first })

    expect(decision.action).toBe('apply')
    if (decision.action !== 'apply') return

    const replay = decidePaymentApply({
      order: order({ processedEventIds: processedEventIdsFrom([decision.note]) }),
      event: first,
    })

    expect(replay).toEqual({ action: 'ignore', reason: 'duplicate_event' })
  })
})
