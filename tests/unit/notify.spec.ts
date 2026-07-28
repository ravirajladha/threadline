/**
 * Notifications — the templates, the channel, the dispatcher and the status map.
 *
 * Two properties carry most of the weight here, and both are about *not* sending:
 *
 * - the dispatcher never throws, because its callers are a checkout and a status transition
 * - it never sends the same message twice, because a cron firing hourly would otherwise mail hourly
 *
 * The wording is tested too. A greeting that reads "Hi null," or a total that renders as `129900`
 * is a customer's screenshot, and it costs one assertion to make it a test instead.
 */
import { describe, expect, it, vi } from 'vitest'

import { ConsoleChannel } from '@/lib/notify/consoleChannel'
import { claimsSubject, createDispatcher } from '@/lib/notify/dispatcher'
import {
  createNotificationChannels,
  NotificationConfigurationError,
} from '@/lib/notify/factory'
import { emailRecipient, firstNameOf } from '@/lib/notify/recipient'
import { allTemplateKeys, renderNotification, templateKeyFor, TEMPLATES } from '@/lib/notify/templates'
import type { NotificationChannel, Recipient, RenderedMessage } from '@/lib/notify/types'
import {
  notificationForStatus,
  statusMessageFor,
  statusSubject,
  STATUS_NOTIFICATIONS,
} from '@/lib/orders/statusNotification'
import { NOTIFICATION_EVENTS, ORDER_STATUSES, type NotificationEvent } from '@/types'
import type { Payload } from 'payload'

const RECIPIENT: Recipient = { address: 'asha@example.com', name: 'Asha' }

/** Every event with a plausible set of its own variables, so the table can be walked. */
const SAMPLES: { [E in NotificationEvent]: Parameters<typeof renderNotification>[0] } = {
  'order.placed': { event: 'order.placed', variables: { orderNumber: '260727-0007', itemCount: 2, totalPaise: 249_900 } },
  'order.confirmed': { event: 'order.confirmed', variables: { orderNumber: '260727-0007', totalPaise: 249_900 } },
  'order.shipped': { event: 'order.shipped', variables: { orderNumber: '260727-0007', courier: 'Stub Express', awbCode: '000123456789' } },
  'order.out_for_delivery': { event: 'order.out_for_delivery', variables: { orderNumber: '260727-0007', courier: 'Stub Express' } },
  'order.delivered': { event: 'order.delivered', variables: { orderNumber: '260727-0007' } },
  'order.cancelled': { event: 'order.cancelled', variables: { orderNumber: '260727-0007' } },
  'order.refunded': { event: 'order.refunded', variables: { orderNumber: '260727-0007', totalPaise: 249_900 } },
  'cart.abandoned': { event: 'cart.abandoned', variables: { itemCount: 3 } },
  'stock.back_in_stock': { event: 'stock.back_in_stock', variables: { sku: 'TL-SHIRT-NAVY-M', available: 2 } },
  'order.review_request': { event: 'order.review_request', variables: { orderNumber: '260727-0007' } },
  'ticket.replied': { event: 'ticket.replied', variables: { ticketNumber: 'TS-260727-0007', subject: 'Wrong size' } },
  'ticket.resolved': { event: 'ticket.resolved', variables: { ticketNumber: 'TS-260727-0007', subject: 'Wrong size' } },
}

describe('templates', () => {
  it('has one for every event', () => {
    // The map's type already requires this; the test proves each entry actually renders rather
    // than merely existing.
    for (const event of NOTIFICATION_EVENTS) {
      const message = renderNotification(SAMPLES[event], 'Asha')

      expect(message.subject.length).toBeGreaterThan(0)
      expect(message.text.length).toBeGreaterThan(0)
    }
  })

  it('gives every event a distinct template key', () => {
    const keys = allTemplateKeys()

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('greets by first name', () => {
    expect(renderNotification(SAMPLES['order.delivered'], 'Asha').text).toContain('Hi Asha,')
  })

  it('greets a guest without saying null', () => {
    // The failure this exists for: a guest checkout has no name, and "Hi null," is what ships.
    const text = renderNotification(SAMPLES['order.delivered'], null).text

    expect(text).toContain('Hi there,')
    expect(text).not.toContain('null')
  })

  it('formats money as rupees, never as paise', () => {
    const text = renderNotification(SAMPLES['order.confirmed'], 'Asha').text

    expect(text).toContain('2,499')
    expect(text).not.toContain('249900')
  })

  it('names the parcel and its tracking number when it ships', () => {
    const text = renderNotification(SAMPLES['order.shipped'], 'Asha').text

    expect(text).toContain('Stub Express')
    expect(text).toContain('000123456789')
  })

  it('says how many are left only when stock is low', () => {
    expect(renderNotification(SAMPLES['stock.back_in_stock'], null).text).toContain('only 2 left')
    expect(
      renderNotification({ event: 'stock.back_in_stock', variables: { sku: 'X', available: 40 } }, null).text,
    ).not.toContain('left')
  })

  it('pluralises an item count', () => {
    expect(renderNotification({ event: 'cart.abandoned', variables: { itemCount: 1 } }, null).text).toContain('1 item ')
    expect(renderNotification({ event: 'cart.abandoned', variables: { itemCount: 4 } }, null).text).toContain('4 items')
  })

  it('reports the stored template key', () => {
    expect(templateKeyFor('order.shipped')).toBe(TEMPLATES['order.shipped'].key)
  })
})

describe('ConsoleChannel', () => {
  const channel = (write = vi.fn()): { channel: ConsoleChannel; write: ReturnType<typeof vi.fn> } => ({
    channel: new ConsoleChannel({ write, newId: () => 'fixed' }),
    write,
  })

  const message: RenderedMessage = { subject: 'Hello', text: 'Line one\nLine two' }

  it('sends to a plausible email address', async () => {
    const { channel: email, write } = channel()

    const outcome = await email.send(RECIPIENT, message)

    expect(outcome).toEqual({ ok: true, providerId: 'console_fixed' })
    expect(write).toHaveBeenCalledOnce()
  })

  it('prints the subject and body where a developer will see them', async () => {
    const { channel: email, write } = channel()

    await email.send(RECIPIENT, message)

    const printed = String(write.mock.calls[0]?.[0])

    expect(printed).toContain('Hello')
    expect(printed).toContain('Line two')
  })

  it('cannot reach an empty or malformed address', () => {
    const { channel: email } = channel()

    expect(email.canReach({ address: '' })).toBe(false)
    expect(email.canReach({ address: '   ' })).toBe(false)
    expect(email.canReach({ address: 'not-an-address' })).toBe(false)
    expect(email.canReach(RECIPIENT)).toBe(true)
  })

  it('judges a phone number by the WhatsApp channel’s rules, not the email one', () => {
    const whatsapp = new ConsoleChannel({ name: 'whatsapp', write: vi.fn() })

    expect(whatsapp.canReach({ address: '+919876543210' })).toBe(true)
    expect(whatsapp.canReach({ address: 'asha@example.com' })).toBe(false)
  })

  it('refuses rather than fabricating a success for an unreachable recipient', async () => {
    // A caller that skips `canReach` must not be told a message was delivered.
    const { channel: email, write } = channel()

    const outcome = await email.send({ address: '' }, message)

    expect(outcome.ok).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('gives each send its own id', async () => {
    const email = new ConsoleChannel({ write: vi.fn() })

    const first = await email.send(RECIPIENT, message)
    const second = await email.send(RECIPIENT, message)

    expect(first).not.toEqual(second)
  })
})

// --- Dispatcher --------------------------------------------------------------

interface FakeRow {
  event: string
  recipient: string
  status: string
  payload: Record<string, unknown>
  error?: string
  providerId?: string
}

function fakePayload() {
  const rows: FakeRow[] = []
  const logged: Array<{ level: string; payload: unknown }> = []

  const payload = {
    logger: {
      info: (p: unknown) => logged.push({ level: 'info', payload: p }),
      warn: (p: unknown) => logged.push({ level: 'warn', payload: p }),
      error: (p: unknown) => logged.push({ level: 'error', payload: p }),
    },
    async find({ collection, where }: { collection: string; where?: unknown }): Promise<{ docs: unknown[] }> {
      if (collection !== 'notifications') return { docs: [] }

      const conditions = (where as { and?: Array<Record<string, { equals?: unknown }>> })?.and ?? []
      const event = conditions[0]?.event?.equals
      const recipient = conditions[1]?.recipient?.equals

      return { docs: rows.filter((row) => row.event === event && row.recipient === recipient) }
    },
    async create({ collection, data }: { collection: string; data: Record<string, unknown> }): Promise<unknown> {
      if (collection === 'notifications') rows.push(data as unknown as FakeRow)

      return { id: rows.length }
    },
  }

  return { rows, logged, payload: payload as unknown as Payload }
}

/** A channel that always reaches and always succeeds, unless told otherwise. */
function stubChannel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    name: 'email',
    canReach: () => true,
    send: () => Promise.resolve({ ok: true as const, providerId: 'p1' }),
    ...overrides,
  }
}

const PLACED = SAMPLES['order.placed']

describe('dispatcher', () => {
  it('renders, sends and records one message', async () => {
    const { rows, payload } = fakePayload()
    const notify = createDispatcher({ payload, channels: [stubChannel()] })

    const result = await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })

    expect(result).toMatchObject({ status: 'sent', channel: 'email', providerId: 'p1' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ event: 'order.placed', status: 'sent', templateKey: 'order-placed' })
  })

  it('stores the subject alongside the variables, which is what makes the dedupe work', async () => {
    const { rows, payload } = fakePayload()
    const notify = createDispatcher({ payload, channels: [stubChannel()] })

    await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })

    expect(rows[0]?.payload).toMatchObject({ subject: 'order:1', orderNumber: '260727-0007' })
  })

  it('never stores the recipient inside the variables', async () => {
    // The address is a column, deliberately. Copying it into the JSON would spread PII into a blob
    // nobody thinks to redact (OWASP A09).
    const { rows, payload } = fakePayload()
    const notify = createDispatcher({ payload, channels: [stubChannel()] })

    await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })

    expect(JSON.stringify(rows[0]?.payload)).not.toContain('asha@example.com')
  })

  it('sends the same subject only once', async () => {
    const { rows, payload } = fakePayload()
    const send = vi.fn().mockResolvedValue({ ok: true, providerId: 'p1' })
    const notify = createDispatcher({ payload, channels: [stubChannel({ send })] })

    await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })
    const second = await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })

    expect(second).toMatchObject({ status: 'duplicate' })
    expect(send).toHaveBeenCalledOnce()
    expect(rows).toHaveLength(1)
  })

  it('treats a different subject as a different message', async () => {
    const { rows, payload } = fakePayload()
    const notify = createDispatcher({ payload, channels: [stubChannel()] })

    await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })
    await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:2' })

    expect(rows).toHaveLength(2)
  })

  it('reports an unreachable recipient without writing a failed row', async () => {
    // Nothing to retry and nobody to tell. A failure row here would fill the log with noise that
    // hides the failures somebody can act on.
    const { rows, payload } = fakePayload()
    const notify = createDispatcher({ payload, channels: [stubChannel({ canReach: () => false })] })

    const result = await notify.dispatch({ ...PLACED, recipient: { address: '' }, subject: 'order:1' })

    expect(result).toMatchObject({ status: 'unreachable' })
    expect(rows).toHaveLength(0)
  })

  it('picks the first channel that can reach the recipient', async () => {
    const { payload } = fakePayload()
    const whatsapp = stubChannel({ name: 'whatsapp', send: vi.fn().mockResolvedValue({ ok: true, providerId: 'w1' }) })
    const notify = createDispatcher({
      payload,
      channels: [stubChannel({ canReach: () => false }), whatsapp],
    })

    const result = await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })

    expect(result).toMatchObject({ status: 'sent', channel: 'whatsapp' })
  })

  it('records a failed send and says why', async () => {
    const { rows, payload } = fakePayload()
    const notify = createDispatcher({
      payload,
      channels: [stubChannel({ send: () => Promise.resolve({ ok: false, error: 'provider is down' }) })],
    })

    const result = await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })

    expect(result).toMatchObject({ status: 'failed', error: 'provider is down' })
    // The row exists, because "I never received it" is the question this table answers.
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'provider is down' })
  })

  it('does not throw when a channel throws', async () => {
    // The rule the whole file is built around: a provider having a bad afternoon must not fail an
    // order. `send` promises an outcome rather than a throw — a promise a real SDK will break.
    const { payload } = fakePayload()
    const notify = createDispatcher({
      payload,
      channels: [stubChannel({ send: () => Promise.reject(new Error('socket hang up')) })],
    })

    const result = await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })

    expect(result).toMatchObject({ status: 'failed', error: 'socket hang up' })
  })

  it('does not throw when the database is unavailable', async () => {
    const { payload } = fakePayload()
    const broken = {
      ...payload,
      find: () => Promise.reject(new Error('connection refused')),
    } as unknown as Payload
    const notify = createDispatcher({ payload: broken, channels: [stubChannel()] })

    await expect(
      notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' }),
    ).resolves.toMatchObject({ status: 'failed' })
  })

  it('never logs the recipient’s address', async () => {
    const { logged, payload } = fakePayload()
    const notify = createDispatcher({
      payload,
      channels: [stubChannel({ send: () => Promise.resolve({ ok: false, error: 'bounced' }) })],
    })

    await notify.dispatch({ ...PLACED, recipient: RECIPIENT, subject: 'order:1' })

    expect(JSON.stringify(logged)).not.toContain('asha@example.com')
  })

  it('refuses an event it does not recognise instead of throwing', async () => {
    // Reachable from a job that read an event name out of a row.
    const { payload } = fakePayload()
    const notify = createDispatcher({ payload, channels: [stubChannel()] })

    const result = await notify.dispatch({
      ...(({ event: 'order.teleported', variables: {} } as unknown) as typeof PLACED),
      recipient: RECIPIENT,
      subject: 'order:1',
    })

    expect(result.status).toBe('unreachable')
  })
})

describe('claimsSubject', () => {
  it('recognises a subject already claimed in the log', () => {
    expect(claimsSubject([{ payload: { subject: 'order:260720-0003' } }], 'order:260720-0003')).toBe(true)
  })

  it('matches the subject exactly, never by prefix', () => {
    // A looser rule would let one order's message suppress another's the day order numbers gain
    // a suffix.
    expect(claimsSubject([{ payload: { subject: 'order:260720-0003-A' } }], 'order:260720-0003')).toBe(false)
  })

  it('survives a row whose payload is missing or not an object', () => {
    expect(claimsSubject([{ payload: null }, { payload: 'text' }, {}], 'order:1')).toBe(false)
  })
})

describe('factory', () => {
  it('builds the console channel in development', () => {
    const channels = createNotificationChannels({ NODE_ENV: 'development' })

    expect(channels).toHaveLength(1)
    expect(channels[0]?.name).toBe('email')
  })

  it('refuses to run the console channel in production', () => {
    // A shop that prints its confirmations to a log instead of sending them is worse than one that
    // refuses to boot, because every order looks fine and no customer hears anything.
    expect(() => createNotificationChannels({ NODE_ENV: 'production' })).toThrow(
      NotificationConfigurationError,
    )
  })

  it('refuses a provider that is not implemented yet rather than downgrading silently', () => {
    expect(() => createNotificationChannels({ NOTIFICATION_PROVIDER: 'resend' })).toThrow(
      NotificationConfigurationError,
    )
  })

  it('refuses a provider it has never heard of', () => {
    expect(() => createNotificationChannels({ NOTIFICATION_PROVIDER: 'carrier-pigeon' })).toThrow(
      NotificationConfigurationError,
    )
  })
})

describe('recipient', () => {
  it('takes the first name for a greeting', () => {
    expect(firstNameOf('Asha Menon')).toBe('Asha')
    expect(firstNameOf('  Asha  ')).toBe('Asha')
  })

  it('has no name to give when there is none', () => {
    expect(firstNameOf(null)).toBeNull()
    expect(firstNameOf('   ')).toBeNull()
  })

  it('builds a recipient from an account', () => {
    expect(emailRecipient({ email: 'asha@example.com', name: 'Asha Menon' })).toEqual({
      address: 'asha@example.com',
      name: 'Asha',
    })
  })

  it('is null when there is nowhere to write to', () => {
    expect(emailRecipient({ email: null })).toBeNull()
    expect(emailRecipient({ email: '   ' })).toBeNull()
  })
})

describe('status notifications', () => {
  it('has an answer for every order status', () => {
    // Exhaustive by type; the test proves a status added to the machine cannot slip through as
    // undefined and silently mean "say nothing".
    for (const status of ORDER_STATUSES) {
      expect(STATUS_NOTIFICATIONS).toHaveProperty(status)
    }
  })

  it('stays quiet about internal steps', () => {
    // A shop that emails at every internal step teaches customers to filter it.
    expect(notificationForStatus('packed')).toBeNull()
    expect(notificationForStatus('rto')).toBeNull()
    expect(notificationForStatus('payment_failed')).toBeNull()
  })

  it('announces the steps a customer is waiting on', () => {
    expect(notificationForStatus('shipped')).toBe('order.shipped')
    expect(notificationForStatus('delivered')).toBe('order.delivered')
    expect(notificationForStatus('refunded')).toBe('order.refunded')
  })

  it('does not repeat the opening message from a transition', () => {
    // Checkout sends `order.placed`; sending it from here too is two emails for one order.
    expect(notificationForStatus('pending')).toBeNull()
  })

  it('pairs a shipped status with the courier and the tracking number', () => {
    const message = statusMessageFor('shipped', {
      orderNumber: '260727-0007',
      grandTotal: 249_900,
      courier: 'Stub Express',
      awbCode: '000123456789',
    })

    expect(message).toMatchObject({
      event: 'order.shipped',
      variables: { courier: 'Stub Express', awbCode: '000123456789' },
    })
  })

  it('never puts a blank tracking number in a customer’s email', () => {
    const message = statusMessageFor('shipped', {
      orderNumber: '260727-0007',
      grandTotal: 249_900,
      courier: null,
      awbCode: '',
    })

    expect(JSON.stringify(message)).not.toContain('null')
    expect(message).toMatchObject({ variables: { courier: 'Our courier' } })
  })

  it('has nothing to say about a silent status', () => {
    expect(statusMessageFor('packed', { orderNumber: '260727-0007', grandTotal: 1 })).toBeNull()
  })

  it('keys the subject on the order and the status', () => {
    // So an order that is cancelled and later refunded gets both messages.
    expect(statusSubject('260727-0007', 'cancelled')).not.toBe(statusSubject('260727-0007', 'refunded'))
  })
})
