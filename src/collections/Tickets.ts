import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { customerIdOf, ownScopedRead, staffWrite } from '@/access'
import { ticketAssignEndpoint, ticketReplyEndpoint, ticketStatusEndpoint } from '@/endpoints/support'
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, MESSAGE_AUTHOR_TYPES } from '@/types'

/** Stamp the raiser from the session, so a ticket cannot be filed under another account. */
const stampCustomer: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation !== 'create') return data

  const customerId = customerIdOf(req.user)
  return customerId === null ? data : { ...data, customer: customerId }
}

/**
 * Customer support tickets.
 *
 * Support is treated as a product surface rather than a mailto link: a customer sees their own
 * requests and the replies on them, and an agent works a real inbox with assignment and
 * priority. `escalatedFromBot` marks the ones the Claude assistant could not finish, which is
 * both the handoff mechanism and the measure of whether the assistant is any good.
 *
 * `firstResponseAt` and `resolvedAt` exist so response time is a number, not an impression.
 */
export const Tickets: CollectionConfig = {
  slug: 'tickets',
  access: {
    read: ownScopedRead({ resource: 'support', ownerField: 'customer' }),
    /**
     * Staff only — a customer raises a ticket through `/api/support`, never through this
     * collection's own REST route.
     *
     * It was `customerOrStaffCreate('support')` until the J7 security pass, which is a real hole:
     * Payload exposes `POST /api/tickets` whatever our routes do, and `stampCustomer` only fixes
     * the *owner*. Everything else in the body was the customer's to choose — a `ticketNumber` that
     * collides or reads however they like, a `firstResponseAt` that skews response-time reporting,
     * and, worst, an opening message with `authorType: 'agent'` and the author "Threadline Support",
     * which is a fabricated quote from us sitting in a real thread (OWASP A04).
     *
     * The same reasoning as `carts.create: denyAll` in J4: the port is the only writer, so the
     * server owns the reference, the status and who each message is from. Staff keep create so an
     * agent can still raise a ticket on a customer's behalf after a phone call.
     */
    create: staffWrite('support'),
    // Replies are appended through the support port, which re-checks ownership; letting a customer
    // PATCH the row directly would let them rewrite an agent's message.
    update: staffWrite('support'),
    delete: staffWrite('support'),
  },
  admin: {
    useAsTitle: 'subject',
    defaultColumns: ['ticketNumber', 'subject', 'status', 'priority', 'assignedTo'],
    group: 'Engagement',
  },
  hooks: {
    beforeChange: [stampCustomer],
  },
  endpoints: [ticketReplyEndpoint, ticketStatusEndpoint, ticketAssignEndpoint],
  fields: [
    {
      name: 'supportActions',
      type: 'ui',
      admin: {
        components: { Field: '@/components/admin/TicketActions#TicketActions' },
        condition: (data) => Boolean(data?.id),
      },
    },
    {
      name: 'ticketNumber',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true, description: 'The reference the customer quotes.' },
    },
    { name: 'customer', type: 'relationship', relationTo: 'customers', required: true, index: true },
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      index: true,
      admin: { description: 'Attached when the request is about a specific order.' },
    },
    { name: 'subject', type: 'text', required: true },
    {
      name: 'category',
      type: 'select',
      required: true,
      defaultValue: 'other',
      index: true,
      options: TICKET_CATEGORIES.map((value) => ({ label: value, value })),
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      index: true,
      options: TICKET_STATUSES.map((value) => ({ label: value, value })),
      admin: { position: 'sidebar' },
    },
    {
      name: 'priority',
      type: 'select',
      required: true,
      defaultValue: 'normal',
      options: TICKET_PRIORITIES.map((value) => ({ label: value, value })),
      admin: { position: 'sidebar' },
    },
    {
      name: 'assignedTo',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: { position: 'sidebar', description: 'Unassigned tickets are nobody’s job.' },
    },
    {
      name: 'messages',
      type: 'array',
      fields: [
        { name: 'author', type: 'text', required: true, admin: { description: 'Display name shown on the message.' } },
        {
          name: 'authorType',
          type: 'select',
          required: true,
          options: MESSAGE_AUTHOR_TYPES.map((value) => ({ label: value, value })),
        },
        { name: 'body', type: 'textarea', required: true },
        {
          name: 'attachments',
          type: 'array',
          fields: [{ name: 'file', type: 'upload', relationTo: 'media', required: true }],
        },
        { name: 'sentAt', type: 'date', required: true },
      ],
    },
    {
      name: 'escalatedFromBot',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'The assistant handed this over. Worth reading to improve its prompts.' },
    },
    {
      name: 'firstResponseAt',
      type: 'date',
      admin: { readOnly: true, description: 'When an agent first replied. Drives response-time reporting.' },
    },
    { name: 'resolvedAt', type: 'date', admin: { readOnly: true } },
  ],
}
