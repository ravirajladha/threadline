/**
 * The ten messages, as one table.
 *
 * Every template is a pure function from typed variables to a subject and a body, which is what
 * makes the wording testable — a broken greeting or a missing order number is a unit test here, not
 * a customer's screenshot.
 *
 * **Variables are typed per event.** `NotificationVariables` maps each event to exactly the fields
 * its template may use, so a template cannot reference something the caller does not supply and a
 * caller cannot forget a field the template needs. The alternative — one loose
 * `Record<string, unknown>` — fails at the only moment that matters, in front of a customer.
 *
 * **What a variable may hold is a security decision, not a formatting one** (OWASP A09). These
 * carry an order number, a first name, a count, a status and a money figure. Deliberately *not*
 * present: the full address, the payment id, any token, the customer's phone or email (the address
 * is the `Recipient`, not a template variable, so it is never copied into the stored row). The
 * `notifications.payload` column is written straight from this object, so anything added here ends
 * up persisted and readable by every support agent.
 *
 * Money crosses as **integer paise** and is formatted here, because a template is precisely the
 * render boundary CLAUDE.md §2 allows formatting at.
 */
import { Money } from '@/lib/pricing/money'
import { NOTIFICATION_EVENTS, type NotificationEvent } from '@/types'
import type { RenderedMessage } from './types'

/** The variables each event's template may use. */
export interface NotificationVariables {
  'order.placed': { orderNumber: string; itemCount: number; totalPaise: number }
  'order.confirmed': { orderNumber: string; totalPaise: number }
  'order.shipped': { orderNumber: string; courier: string; awbCode: string }
  'order.out_for_delivery': { orderNumber: string; courier: string }
  'order.delivered': { orderNumber: string }
  'order.cancelled': { orderNumber: string }
  'order.refunded': { orderNumber: string; totalPaise: number }
  'cart.abandoned': { itemCount: number }
  'stock.back_in_stock': { sku: string; available: number }
  'order.review_request': { orderNumber: string }
  // The ticket's own subject line, which the customer wrote. Never the reply body: a notification
  // is a nudge to come and read the thread, not a copy of it in a channel with different access.
  'ticket.replied': { ticketNumber: string; subject: string }
  'ticket.resolved': { ticketNumber: string; subject: string }
}

/** Everything a template is given: its own variables, plus who it is addressed to. */
export interface TemplateContext<E extends NotificationEvent> {
  variables: NotificationVariables[E]
  /** First name, or null for a guest. Templates must read as sensible either way. */
  name: string | null
}

export interface NotificationTemplate<E extends NotificationEvent> {
  /** Stored on the row, so a support agent can name the message a customer is asking about. */
  key: string
  render(context: TemplateContext<E>): RenderedMessage
}

/** ₹1,299.00 — formatted once, here, at the render boundary. */
function money(paise: number): string {
  return Money.fromPaise(paise).format()
}

/**
 * "Hi Asha," or "Hi there," — never "Hi null,".
 *
 * A guest checkout has no name, and the template that greets them by it is the one that ships.
 */
function greeting(name: string | null): string {
  const trimmed = name?.trim() ?? ''

  return trimmed.length > 0 ? `Hi ${trimmed},` : 'Hi there,'
}

/** Composes a body from lines, so no template has to think about trailing whitespace. */
function body(...lines: string[]): string {
  return lines.join('\n\n')
}

const SIGN_OFF = '— Threadline'

/**
 * The table.
 *
 * Typed as a mapped type over the event union, which is what makes "every event has a template" a
 * compile error rather than a runtime surprise. A test additionally walks `NOTIFICATION_EVENTS`,
 * because the map could still be satisfied by a template that throws.
 */
export const TEMPLATES: { [E in NotificationEvent]: NotificationTemplate<E> } = {
  'order.placed': {
    key: 'order-placed',
    render: ({ variables, name }) => ({
      subject: `We've got your order ${variables.orderNumber}`,
      text: body(
        greeting(name),
        `Thanks for your order. We're getting ${variables.itemCount === 1 ? 'it' : 'them'} ready.`,
        `Order ${variables.orderNumber} · ${variables.itemCount} item${variables.itemCount === 1 ? '' : 's'} · ${money(variables.totalPaise)}`,
        "We'll email you again the moment it's on its way.",
        SIGN_OFF,
      ),
    }),
  },

  'order.confirmed': {
    key: 'order-confirmed',
    render: ({ variables, name }) => ({
      subject: `Payment received for ${variables.orderNumber}`,
      text: body(
        greeting(name),
        `We've received ${money(variables.totalPaise)} for order ${variables.orderNumber}. It's confirmed and heading to our packing table.`,
        SIGN_OFF,
      ),
    }),
  },

  'order.shipped': {
    key: 'order-shipped',
    render: ({ variables, name }) => ({
      subject: `Your order ${variables.orderNumber} is on its way`,
      text: body(
        greeting(name),
        `${variables.courier} has your parcel.`,
        `Tracking number: ${variables.awbCode}`,
        SIGN_OFF,
      ),
    }),
  },

  'order.out_for_delivery': {
    key: 'order-out-for-delivery',
    render: ({ variables, name }) => ({
      subject: `Arriving today: ${variables.orderNumber}`,
      text: body(
        greeting(name),
        `${variables.courier} is out delivering your parcel today. Someone will need to be there to take it.`,
        SIGN_OFF,
      ),
    }),
  },

  'order.delivered': {
    key: 'order-delivered',
    render: ({ variables, name }) => ({
      subject: `Delivered — order ${variables.orderNumber}`,
      text: body(
        greeting(name),
        `Your parcel has been delivered. We hope it fits beautifully.`,
        `If something isn't right, you can start a return from your account.`,
        SIGN_OFF,
      ),
    }),
  },

  'order.cancelled': {
    key: 'order-cancelled',
    render: ({ variables, name }) => ({
      subject: `Order ${variables.orderNumber} has been cancelled`,
      text: body(
        greeting(name),
        `Order ${variables.orderNumber} is cancelled and nothing further will be charged. Any payment already taken is on its way back to you.`,
        SIGN_OFF,
      ),
    }),
  },

  'order.refunded': {
    key: 'order-refunded',
    render: ({ variables, name }) => ({
      subject: `Your refund for ${variables.orderNumber} is on its way`,
      text: body(
        greeting(name),
        `We've refunded ${money(variables.totalPaise)} for order ${variables.orderNumber}. Banks usually take a few working days to show it.`,
        SIGN_OFF,
      ),
    }),
  },

  'cart.abandoned': {
    key: 'cart-abandoned',
    render: ({ variables, name }) => ({
      subject: 'You left something behind',
      text: body(
        greeting(name),
        `You've still got ${variables.itemCount} item${variables.itemCount === 1 ? '' : 's'} in your bag. We've kept ${variables.itemCount === 1 ? 'it' : 'them'} for you.`,
        // No promise that stock is held — it is not, and saying so would be a lie the checkout
        // then has to break.
        'Popular sizes do sell out, so do come back soon.',
        SIGN_OFF,
      ),
    }),
  },

  'stock.back_in_stock': {
    key: 'stock-back-in-stock',
    render: ({ variables, name }) => ({
      subject: 'Back in stock',
      text: body(
        greeting(name),
        `${variables.sku} is available again${variables.available <= 3 ? ` — only ${variables.available} left` : ''}.`,
        SIGN_OFF,
      ),
    }),
  },

  'ticket.replied': {
    key: 'ticket-replied',
    render: ({ variables, name }) => ({
      subject: `Re: ${variables.subject} (${variables.ticketNumber})`,
      text: body(
        greeting(name),
        `We've replied to your request "${variables.subject}".`,
        `Open ${variables.ticketNumber} in your account to read it and write back.`,
        SIGN_OFF,
      ),
    }),
  },

  'ticket.resolved': {
    key: 'ticket-resolved',
    render: ({ variables, name }) => ({
      subject: `Resolved: ${variables.subject} (${variables.ticketNumber})`,
      text: body(
        greeting(name),
        `We've marked your request "${variables.subject}" as resolved.`,
        // Reopening is legal from `resolved`, so saying so is accurate rather than a courtesy.
        'If that is not right, just reply on the thread and it comes straight back to us.',
        SIGN_OFF,
      ),
    }),
  },

  'order.review_request': {
    key: 'order-review-request',
    render: ({ variables, name }) => ({
      subject: 'How did we do?',
      text: body(
        greeting(name),
        `You received order ${variables.orderNumber} a few days ago. How does it fit?`,
        'A sentence or two — and the size you took — helps the next person order the right thing first time.',
        SIGN_OFF,
      ),
    }),
  },
}

/**
 * An event paired with its own variables.
 *
 * Distributed over the union rather than generic, which is what lets a caller build one of these,
 * pass it around, and hand it to `dispatch` — a generic parameter would have to be resolved at the
 * point the value is created, and `statusNotification.ts` decides the event at runtime.
 */
export type NotificationMessage = {
  [E in NotificationEvent]: { event: E; variables: NotificationVariables[E] }
}[NotificationEvent]

/**
 * Render one message. The only way text is produced anywhere in the codebase.
 *
 * The cast is contained here deliberately. `NotificationMessage` only ever pairs an event with its
 * own variables — that is what the mapped type guarantees — but TypeScript cannot carry that
 * correlation through an indexed lookup into `TEMPLATES`. Doing it once, here, keeps every call
 * site honest instead of spreading `as` through the dispatcher.
 */
export function renderNotification(message: NotificationMessage, name: string | null): RenderedMessage {
  const template = TEMPLATES[message.event] as NotificationTemplate<NotificationEvent>

  return template.render({
    variables: message.variables as NotificationVariables[NotificationEvent],
    name,
  })
}

/** The stored `templateKey` for an event. */
export function templateKeyFor(event: NotificationEvent): string {
  return TEMPLATES[event].key
}

/** Every template key, for the test that proves they are unique. */
export function allTemplateKeys(): string[] {
  return NOTIFICATION_EVENTS.map((event) => TEMPLATES[event].key)
}
