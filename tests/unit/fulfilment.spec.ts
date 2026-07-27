/**
 * `orders/fulfilment.ts` — which staff actions an order allows.
 *
 * Two properties carry the weight. The refusal has to name the *most fundamental* reason, or staff
 * are sent to book a courier for an order that was cancelled. And nothing here may contradict
 * `transitions.ts`, so the last test walks every status against the graph rather than trusting the
 * two files to have been edited together.
 */
import { describe, expect, it } from 'vitest'

import {
  describeRefusal,
  evaluateFulfilment,
  FULFILMENT_ACTIONS,
  FULFILMENT_TARGET,
  fulfilmentOptions,
  type FulfilmentState,
} from '@/lib/orders/fulfilment'
import { canTransition } from '@/lib/orders/transitions'
import { ORDER_STATUSES } from '@/types'

function state(overrides: Partial<FulfilmentState> = {}): FulfilmentState {
  return {
    status: 'confirmed',
    paymentStatus: 'paid',
    paymentMethod: 'razorpay',
    awbCode: null,
    ...overrides,
  }
}

describe('evaluateFulfilment', () => {
  it('allows packing a paid, confirmed order', () => {
    expect(evaluateFulfilment(state(), 'pack')).toEqual({
      allowed: true,
      action: 'pack',
      toStatus: 'packed',
    })
  })

  it('refuses packing a prepaid order that has not been paid for', () => {
    // Picking stock against money that never arrived.
    expect(evaluateFulfilment(state({ status: 'pending', paymentStatus: 'pending' }), 'pack')).toMatchObject({
      allowed: false,
      reason: 'illegal_transition',
    })

    // `confirmed` is reachable by hand, so the payment check is not redundant with the graph.
    expect(evaluateFulfilment(state({ paymentStatus: 'pending' }), 'pack')).toMatchObject({
      allowed: false,
      reason: 'unpaid',
    })
  })

  it('allows packing an unpaid COD order, because that is what COD means', () => {
    expect(
      evaluateFulfilment(state({ paymentMethod: 'cod', paymentStatus: 'pending' }), 'pack'),
    ).toMatchObject({ allowed: true })
  })

  it('refuses shipping until a courier has issued an AWB', () => {
    // `packed → shipped` is a legal move, so this is the condition the status graph cannot express.
    expect(evaluateFulfilment(state({ status: 'packed' }), 'ship')).toMatchObject({
      allowed: false,
      reason: 'no_awb',
    })
  })

  it.each([null, '', '   '])('treats %o as no AWB at all', (awbCode) => {
    expect(evaluateFulfilment(state({ status: 'packed', awbCode }), 'ship')).toMatchObject({
      reason: 'no_awb',
    })
  })

  it('allows shipping once there is an AWB', () => {
    expect(
      evaluateFulfilment(state({ status: 'packed', awbCode: '123456789012' }), 'ship'),
    ).toEqual({ allowed: true, action: 'ship', toStatus: 'shipped' })
  })

  it('reports the illegal transition, not the missing AWB, on a cancelled order', () => {
    // The ordering that matters: "book a courier first" on a cancelled order is worse than useless,
    // because it reads as an instruction.
    expect(evaluateFulfilment(state({ status: 'cancelled' }), 'ship')).toMatchObject({
      allowed: false,
      reason: 'illegal_transition',
      from: 'cancelled',
      to: 'shipped',
    })
  })

  it('refuses everything on a terminal order', () => {
    for (const action of FULFILMENT_ACTIONS) {
      expect(evaluateFulfilment(state({ status: 'refunded' }), action)).toMatchObject({
        allowed: false,
        reason: 'illegal_transition',
      })
    }
  })

  it('allows delivery straight from shipped, since many couriers skip the final scan', () => {
    expect(evaluateFulfilment(state({ status: 'shipped' }), 'deliver')).toMatchObject({
      allowed: true,
    })
  })
})

describe('fulfilmentOptions', () => {
  it('returns every action, refusals included, so a disabled button can explain itself', () => {
    const options = fulfilmentOptions(state({ status: 'packed', awbCode: '123456789012' }))

    expect(options).toHaveLength(FULFILMENT_ACTIONS.length)
    expect(options.map((option) => option.action)).toEqual([...FULFILMENT_ACTIONS])
    expect(options.filter((option) => option.allowed)).toHaveLength(1)
  })
})

describe('describeRefusal', () => {
  it('writes a sentence for every refusal reason', () => {
    const refusals = [
      { reason: 'illegal_transition', from: 'cancelled', to: 'shipped' },
      { reason: 'no_awb' },
      { reason: 'unpaid' },
    ] as const

    for (const refusal of refusals) {
      const sentence = describeRefusal(refusal)

      expect(sentence.length).toBeGreaterThan(0)
      // Staff-facing text, so the raw union values must not leak through.
      expect(sentence).not.toMatch(/_/)
    }
  })
})

describe('agreement with the status machine', () => {
  it('never allows an action the transition graph forbids, from any status', () => {
    // The guard against the two files drifting apart. `fulfilment.ts` may be *stricter* than the
    // graph — that is what `no_awb` and `unpaid` are — but it may never be more permissive.
    for (const status of ORDER_STATUSES) {
      for (const action of FULFILMENT_ACTIONS) {
        const decision = evaluateFulfilment(
          { status, paymentStatus: 'paid', paymentMethod: 'razorpay', awbCode: '123456789012' },
          action,
        )

        if (decision.allowed) {
          expect(canTransition(status, FULFILMENT_TARGET[action])).toBe(true)
        }
      }
    }
  })
})
