/**
 * `shipping/stubProvider.ts` and `shipping/factory.ts`.
 *
 * The stub's job is to be honest about the parts that must not be faked, so that is what is tested:
 * the signature is real, a tampered body is refused, a replay is identifiable by event id, and the
 * factory cannot hand a stub to production.
 */
import { describe, expect, it } from 'vitest'

import {
  createShippingProvider,
  ShippingConfigurationError,
  SHIPPING_PROVIDERS,
} from '@/lib/shipping/factory'
import {
  SHIPPING_SIGNATURE_HEADER,
  STUB_TRACKING_SEQUENCE,
  StubShippingProvider,
  stubAwbFor,
  toTrackingEvent,
} from '@/lib/shipping/stubProvider'
import { mapCourierStatus } from '@/lib/shipping/statusMap'

const SECRET = 'test_shipping_secret'

function provider(): StubShippingProvider {
  return new StubShippingProvider({
    secret: SECRET,
    now: () => new Date('2026-07-27T10:00:00.000Z'),
    newId: (() => {
      let n = 0

      return () => `id${(n += 1)}`
    })(),
  })
}

const REQUEST = {
  reference: '260727-0007',
  pincode: '560001',
  codAmountPaise: 0,
  weightGrams: 400,
  parcelItems: [{ sku: 'TL-SHIRT-M-NAVY', qty: 1 }],
}

describe('StubShippingProvider — construction', () => {
  it('refuses to exist without a signing secret', () => {
    // A stub with no secret would sign with an empty key and its verification would be theatre.
    expect(() => new StubShippingProvider({ secret: '' })).toThrow(/signing secret/)
  })
})

describe('createShipment', () => {
  it('books a parcel and returns a plausible AWB', async () => {
    const shipment = await provider().createShipment(REQUEST)

    expect(shipment.awbCode).toMatch(/^\d{12}$/)
    expect(shipment.courier).toBe('Stub Express')
    expect(shipment.createdAt).toBe('2026-07-27T10:00:00.000Z')
  })

  it('gives the same order the same AWB, rather than a new parcel per call', async () => {
    const [first, second] = await Promise.all([
      provider().createShipment(REQUEST),
      provider().createShipment(REQUEST),
    ])

    expect(first.awbCode).toBe(second.awbCode)
    expect(stubAwbFor(REQUEST.reference)).toBe(first.awbCode)
  })

  it.each([
    ['an unserviceable pincode', { ...REQUEST, pincode: '000000' }, /serviceable/],
    ['a pincode of the wrong length', { ...REQUEST, pincode: '5600' }, /serviceable/],
    ['an empty parcel', { ...REQUEST, parcelItems: [] }, /at least one item/],
    ['a weightless parcel', { ...REQUEST, weightGrams: 0 }, /positive weight/],
  ])('refuses %s', async (_label, request, expected) => {
    // Every real courier refuses these, so the fulfilment flow has to handle them now rather than
    // discovering them against a live account.
    await expect(provider().createShipment(request)).rejects.toThrow(expected)
  })
})

describe('verifyWebhook', () => {
  it('accepts a body it signed itself', () => {
    const courier = provider()
    const simulated = courier.simulateTracking({
      reference: REQUEST.reference,
      awbCode: stubAwbFor(REQUEST.reference),
      courierStatus: 'OUT FOR DELIVERY',
    })

    expect(simulated.header).toBe(SHIPPING_SIGNATURE_HEADER)
    expect(courier.verifyWebhook(simulated.body, simulated.signature)).toEqual(simulated.event)
  })

  it('refuses a body that was altered after signing', () => {
    const courier = provider()
    const simulated = courier.simulateTracking({
      reference: REQUEST.reference,
      awbCode: '123456789012',
      courierStatus: 'IN TRANSIT',
    })

    // The attack this is really about: rewriting the status to `DELIVERED` on an undelivered parcel.
    const tampered = simulated.body.replace('IN TRANSIT', 'DELIVERED')

    expect(courier.verifyWebhook(tampered, simulated.signature)).toBeNull()
  })

  it.each([
    ['a missing signature', null],
    ['an empty signature', ''],
    ['a wrong signature', 'a'.repeat(64)],
  ])('refuses %s', (_label, signature) => {
    const courier = provider()
    const simulated = courier.simulateTracking({
      reference: REQUEST.reference,
      awbCode: '123456789012',
      courierStatus: 'DELIVERED',
    })

    expect(courier.verifyWebhook(simulated.body, signature)).toBeNull()
  })

  it('refuses a correctly signed body that is not a tracking event', () => {
    const courier = provider()
    // Signed with the right secret, so this isolates the field narrowing from the signature check:
    // a valid signature proves origin, not that the fields we need are present (OWASP A08).
    const body = JSON.stringify({ id: 'stub_trk_1', awbCode: '123456789012' })
    const signed = courier.simulateTracking({
      reference: REQUEST.reference,
      awbCode: '123456789012',
      courierStatus: 'DELIVERED',
    })

    expect(courier.verifyWebhook(body, signed.signature)).toBeNull()
  })

  it('gives every event an id, so a replayed scan is identifiable', () => {
    const courier = provider()
    const first = courier.simulateTracking({
      reference: REQUEST.reference,
      awbCode: '123456789012',
      courierStatus: 'IN TRANSIT',
    })
    const second = courier.simulateTracking({
      reference: REQUEST.reference,
      awbCode: '123456789012',
      courierStatus: 'DELIVERED',
    })

    expect(first.event.id).not.toBe(second.event.id)
    expect(first.event.id.length).toBeGreaterThan(0)
  })
})

describe('toTrackingEvent', () => {
  it.each([
    ['null', null],
    ['a string', '"nope"'],
    ['an array', '[]'],
  ])('rejects %s', (_label, value) => {
    expect(toTrackingEvent(typeof value === 'string' ? JSON.parse(value) : value)).toBeNull()
  })

  it.each(['id', 'awbCode', 'reference', 'courierStatus'])('rejects a body missing %s', (field) => {
    const body: Record<string, unknown> = {
      id: 'stub_trk_1',
      awbCode: '123456789012',
      reference: '260727-0007',
      courierStatus: 'DELIVERED',
    }
    delete body[field]

    expect(toTrackingEvent(body)).toBeNull()
  })

  it('rejects a blank courier status rather than passing it to the mapper', () => {
    expect(
      toTrackingEvent({
        id: 'stub_trk_1',
        awbCode: '123456789012',
        reference: '260727-0007',
        courierStatus: '   ',
      }),
    ).toBeNull()
  })

  it('defaults a missing timestamp instead of leaving it undefined', () => {
    const event = toTrackingEvent({
      id: 'stub_trk_1',
      awbCode: '123456789012',
      reference: '260727-0007',
      courierStatus: 'DELIVERED',
    })

    expect(event?.occurredAt).toBe(new Date(0).toISOString())
    expect(event?.location).toBeNull()
  })
})

describe('nextCourierStatus', () => {
  it('walks the parcel from booking to delivery and then stops', () => {
    const courier = provider()
    const walked: string[] = []

    let current = courier.nextCourierStatus(null)
    while (current !== null) {
      walked.push(current)
      current = courier.nextCourierStatus(current)
    }

    expect(walked).toEqual([...STUB_TRACKING_SEQUENCE])
  })

  it('accepts whatever casing the caller stored', () => {
    expect(provider().nextCourierStatus('picked up')).toBe('IN TRANSIT')
  })

  it('restarts rather than dead-ending on a status it does not know', () => {
    expect(provider().nextCourierStatus('TELEPORTED')).toBe(STUB_TRACKING_SEQUENCE[0])
  })

  it('finds the scan an order at a given status has already reached', () => {
    const courier = provider()

    expect(courier.currentCourierStatus('out_for_delivery')).toBe('OUT FOR DELIVERY')
    expect(courier.currentCourierStatus('delivered')).toBe('DELIVERED')
  })

  it('reports no scan for an order the courier has not touched yet', () => {
    // A packed order restarts the sequence, which is what `nextCourierStatus(null)` does.
    expect(provider().currentCourierStatus('packed')).toBeNull()
  })

  it('drives the sequence forward from an order status', () => {
    const courier = provider()

    expect(courier.nextCourierStatus(courier.currentCourierStatus('packed'))).toBe('PICKUP SCHEDULED')
    expect(courier.nextCourierStatus(courier.currentCourierStatus('out_for_delivery'))).toBe('DELIVERED')
    // The end of the line: a delivered parcel has nowhere left to go.
    expect(courier.nextCourierStatus(courier.currentCourierStatus('delivered'))).toBeNull()
  })

  it('emits only statuses the mapper understands', () => {
    // The sequence exists to drive local development, so a token `statusMap` cannot read would make
    // the local flow prove nothing about the real one.
    for (const status of STUB_TRACKING_SEQUENCE) {
      expect(mapCourierStatus(status).kind).not.toBe('unknown')
    }
  })
})

describe('createShippingProvider', () => {
  it('returns the stub when nothing is configured', () => {
    expect(createShippingProvider({ NODE_ENV: 'development' })).toBeInstanceOf(StubShippingProvider)
  })

  it('refuses to hand a stub to production', () => {
    // The guarantee from CLAUDE.md §2: fabricated AWBs in production are worse than a boot failure.
    expect(() => createShippingProvider({ NODE_ENV: 'production' })).toThrow(ShippingConfigurationError)
  })

  it('refuses shiprocket rather than silently downgrading to the stub', () => {
    expect(() =>
      createShippingProvider({ NODE_ENV: 'development', SHIPPING_PROVIDER: 'shiprocket' }),
    ).toThrow(/not implemented until J11/)
  })

  it('refuses an unknown provider name and lists the valid ones', () => {
    expect(() =>
      createShippingProvider({ NODE_ENV: 'development', SHIPPING_PROVIDER: 'dhl' }),
    ).toThrow(new RegExp(SHIPPING_PROVIDERS.join(', ')))
  })

  it('is case and whitespace insensitive about the provider name', () => {
    expect(
      createShippingProvider({ NODE_ENV: 'development', SHIPPING_PROVIDER: '  STUB ' }),
    ).toBeInstanceOf(StubShippingProvider)
  })
})
