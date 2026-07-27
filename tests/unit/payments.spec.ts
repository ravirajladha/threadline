import { describe, expect, it } from 'vitest'

import { hmacSha256Hex, safeCompareHex, verifyHmacSignature } from '@/lib/payments/signature'
import { StubGateway, toPaymentEvent, PAYMENT_SIGNATURE_HEADER } from '@/lib/payments/stubGateway'
import { createPaymentGateway, PaymentConfigurationError } from '@/lib/payments/factory'

const SECRET = 'test_secret'

function gateway(overrides: { now?: () => Date; newId?: () => string } = {}) {
  let counter = 0

  return new StubGateway({
    secret: SECRET,
    now: overrides.now ?? (() => new Date('2026-07-27T09:00:00.000Z')),
    newId: overrides.newId ?? (() => `id${(counter += 1)}`),
  })
}

describe('hmacSha256Hex', () => {
  it('is deterministic for the same secret and payload', () => {
    expect(hmacSha256Hex(SECRET, 'body')).toBe(hmacSha256Hex(SECRET, 'body'))
  })

  it('changes with the secret and with the payload', () => {
    expect(hmacSha256Hex(SECRET, 'body')).not.toBe(hmacSha256Hex('other', 'body'))
    expect(hmacSha256Hex(SECRET, 'body')).not.toBe(hmacSha256Hex(SECRET, 'body '))
  })

  it('produces a 64-character hex digest', () => {
    expect(hmacSha256Hex(SECRET, 'body')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('safeCompareHex', () => {
  it('matches identical digests', () => {
    const digest = hmacSha256Hex(SECRET, 'body')

    expect(safeCompareHex(digest, digest)).toBe(true)
  })

  it('rejects a difference anywhere in the string', () => {
    const digest = hmacSha256Hex(SECRET, 'body')

    expect(safeCompareHex(digest, `0${digest.slice(1)}`)).toBe(false)
    expect(safeCompareHex(digest, `${digest.slice(0, -1)}0`)).toBe(false)
  })

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on unequal lengths; this must return false instead.
    expect(safeCompareHex('abc', 'abcd')).toBe(false)
  })

  it('rejects empty and non-string input', () => {
    expect(safeCompareHex('', '')).toBe(false)
    expect(safeCompareHex(undefined as unknown as string, 'abc')).toBe(false)
  })
})

describe('verifyHmacSignature', () => {
  it('accepts a correct signature', () => {
    expect(
      verifyHmacSignature({ secret: SECRET, payload: 'body', signature: hmacSha256Hex(SECRET, 'body') }),
    ).toBe(true)
  })

  it('tolerates whitespace and upper case in the header', () => {
    const signature = hmacSha256Hex(SECRET, 'body').toUpperCase()

    expect(verifyHmacSignature({ secret: SECRET, payload: 'body', signature: ` ${signature} ` })).toBe(true)
  })

  it('refuses a missing signature', () => {
    // The tempting shortcut — "no signature to check, carry on" — turns a verified endpoint
    // into an open one, and reads as harmless in a diff.
    for (const signature of [null, undefined, '']) {
      expect(verifyHmacSignature({ secret: SECRET, payload: 'body', signature })).toBe(false)
    }
  })

  it('refuses when the secret is not configured', () => {
    expect(verifyHmacSignature({ secret: '', payload: 'body', signature: hmacSha256Hex('', 'body') })).toBe(false)
  })

  it('refuses a body that was tampered with after signing', () => {
    const signature = hmacSha256Hex(SECRET, '{"amountPaise":129900}')

    expect(verifyHmacSignature({ secret: SECRET, payload: '{"amountPaise":1}', signature })).toBe(false)
  })
})

describe('StubGateway — intents', () => {
  it('fabricates an intent carrying our own reference back', async () => {
    const intent = await gateway().createIntent({
      reference: 'TL-260727-0001',
      amountPaise: 129900,
      email: 'asha@example.com',
      phone: '9876543210',
    })

    expect(intent).toEqual({
      gatewayOrderId: 'stub_order_id1',
      amountPaise: 129900,
      currency: 'INR',
      publicKey: 'stub_key',
      reference: 'TL-260727-0001',
    })
  })

  it('refuses an amount below the gateway floor', async () => {
    // Every real gateway has one; failing here means checkout handles it before J11.
    await expect(
      gateway().createIntent({ reference: 'TL-1', amountPaise: 50, email: 'a@b.com', phone: null }),
    ).rejects.toThrow(/at least 100 paise/)
  })

  it('needs a signing secret, so verification is never a no-op', () => {
    expect(() => new StubGateway({ secret: '' })).toThrow(/signing secret/)
  })
})

describe('StubGateway — webhooks', () => {
  it('signs a webhook that its own verifier accepts', () => {
    const stub = gateway()
    const { body, signature, header } = stub.simulateWebhook({
      reference: 'TL-260727-0001',
      gatewayOrderId: 'stub_order_1',
      amountPaise: 129900,
    })

    expect(header).toBe(PAYMENT_SIGNATURE_HEADER)
    expect(stub.verifyWebhook(body, signature)).toMatchObject({
      type: 'payment.captured',
      reference: 'TL-260727-0001',
      amountPaise: 129900,
    })
  })

  it('rejects a body with no signature', () => {
    const stub = gateway()
    const { body } = stub.simulateWebhook({ reference: 'TL-1', gatewayOrderId: 'o', amountPaise: 100 })

    expect(stub.verifyWebhook(body, null)).toBeNull()
  })

  it('rejects a signature from a different secret', () => {
    const stub = gateway()
    const { body } = stub.simulateWebhook({ reference: 'TL-1', gatewayOrderId: 'o', amountPaise: 100 })

    expect(stub.verifyWebhook(body, hmacSha256Hex('attacker', body))).toBeNull()
  })

  it('rejects a body edited after it was signed', () => {
    // The amount is the field worth editing, so it is the one to prove is covered.
    const stub = gateway()
    const { body, signature } = stub.simulateWebhook({ reference: 'TL-1', gatewayOrderId: 'o', amountPaise: 129900 })
    const tampered = body.replace('129900', '100')

    expect(stub.verifyWebhook(tampered, signature)).toBeNull()
  })

  it('rejects a correctly signed body that is not JSON', () => {
    const stub = gateway()

    expect(stub.verifyWebhook('not json', hmacSha256Hex(SECRET, 'not json'))).toBeNull()
  })

  it('rejects a correctly signed body missing required fields', () => {
    // A valid signature proves who sent it, not that it contains what this code expects.
    const stub = gateway()
    const body = JSON.stringify({ id: 'evt_1', type: 'payment.captured' })

    expect(stub.verifyWebhook(body, hmacSha256Hex(SECRET, body))).toBeNull()
  })

  it('carries an event id, so a replay can be recognised', () => {
    const { event } = gateway().simulateWebhook({ reference: 'TL-1', gatewayOrderId: 'o', amountPaise: 100 })

    expect(event.id).toBe('stub_evt_id1')
  })

  it('can simulate a failure as well as a capture', () => {
    const stub = gateway()
    const { body, signature } = stub.simulateWebhook({
      reference: 'TL-1',
      gatewayOrderId: 'o',
      amountPaise: 100,
      type: 'payment.failed',
    })

    expect(stub.verifyWebhook(body, signature)?.type).toBe('payment.failed')
  })
})

describe('StubGateway — checkout confirmation', () => {
  it('accepts the signature its own widget would return', () => {
    const stub = gateway()
    const signature = stub.signCheckout('stub_order_1', 'stub_pay_1')

    expect(
      stub.verifyCheckout({ gatewayOrderId: 'stub_order_1', gatewayPaymentId: 'stub_pay_1', signature }),
    ).toBe(true)
  })

  it('rejects a confirmation for a different payment', () => {
    const stub = gateway()
    const signature = stub.signCheckout('stub_order_1', 'stub_pay_1')

    expect(
      stub.verifyCheckout({ gatewayOrderId: 'stub_order_1', gatewayPaymentId: 'stub_pay_2', signature }),
    ).toBe(false)
  })

  it('rejects a fabricated confirmation', () => {
    expect(
      gateway().verifyCheckout({ gatewayOrderId: 'o', gatewayPaymentId: 'p', signature: 'nope' }),
    ).toBe(false)
  })
})

describe('toPaymentEvent', () => {
  const valid = {
    id: 'evt_1',
    type: 'payment.captured',
    gatewayOrderId: 'order_1',
    gatewayPaymentId: 'pay_1',
    amountPaise: 129900,
    reference: 'TL-260727-0001',
    occurredAt: '2026-07-27T09:00:00.000Z',
  }

  it('accepts a well-formed event', () => {
    expect(toPaymentEvent(valid)).toEqual(valid)
  })

  it('rejects an unknown event type', () => {
    expect(toPaymentEvent({ ...valid, type: 'payment.whatever' })).toBeNull()
  })

  it('rejects a non-integer or negative amount', () => {
    expect(toPaymentEvent({ ...valid, amountPaise: 1299.5 })).toBeNull()
    expect(toPaymentEvent({ ...valid, amountPaise: -1 })).toBeNull()
    expect(toPaymentEvent({ ...valid, amountPaise: '129900' })).toBeNull()
  })

  it('rejects a missing reference, which would otherwise reach a query as undefined', () => {
    expect(toPaymentEvent({ ...valid, reference: undefined })).toBeNull()
  })

  it('rejects anything that is not an object', () => {
    for (const input of [null, undefined, 'string', 42, []]) {
      expect(toPaymentEvent(input), String(input)).toBeNull()
    }
  })

  it('defaults a missing timestamp rather than failing on it', () => {
    expect(toPaymentEvent({ ...valid, occurredAt: undefined })?.occurredAt).toBe(new Date(0).toISOString())
  })
})

describe('createPaymentGateway', () => {
  it('returns the stub in development', () => {
    expect(createPaymentGateway({ NODE_ENV: 'development' }).name).toBe('stub')
  })

  it('refuses to hand out a stub in production', () => {
    // A store that silently accepts fake payments is worse than one that will not boot.
    expect(() => createPaymentGateway({ NODE_ENV: 'production' })).toThrow(PaymentConfigurationError)
  })

  it('refuses a provider that is not implemented yet, rather than downgrading', () => {
    expect(() => createPaymentGateway({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'razorpay' })).toThrow(
      /not implemented until J11/,
    )
  })

  it('refuses an unknown provider name', () => {
    expect(() => createPaymentGateway({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'paypal' })).toThrow(
      PaymentConfigurationError,
    )
  })

  it('uses the configured webhook secret when there is one', () => {
    const configured = createPaymentGateway({ NODE_ENV: 'test', PAYMENT_WEBHOOK_SECRET: 'from_env' })
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'payment.captured',
      gatewayOrderId: 'o',
      gatewayPaymentId: 'p',
      amountPaise: 100,
      reference: 'TL-1',
      occurredAt: '2026-07-27T09:00:00.000Z',
    })

    expect(configured.verifyWebhook(body, hmacSha256Hex('from_env', body))).not.toBeNull()
    expect(configured.verifyWebhook(body, hmacSha256Hex('wrong', body))).toBeNull()
  })
})
