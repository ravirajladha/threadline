import type { CollectionConfig } from 'payload'

import { denyAll, staffRead } from '@/access'
import { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from '@/types'

/**
 * The delivery log for every outbound message — email and WhatsApp alike.
 *
 * One row per send, written by the dispatcher in J6. It answers the question support actually
 * gets asked: "I never received my shipping confirmation." Without a log that is unanswerable.
 *
 * Two rules from CLAUDE.md are visible here. A failure is **logged, never thrown** — an email
 * provider having a bad afternoon must not fail a customer's checkout. And `payload` holds the
 * template variables only: no card data, no tokens, no full address (OWASP A09).
 *
 * `providerId` is indexed because it is how a delivery webhook finds the row it is updating,
 * which is what makes the same event arriving twice idempotent (OWASP A08).
 */
export const Notifications: CollectionConfig = {
  slug: 'notifications',
  access: {
    read: staffRead('support'),
    create: denyAll,
    update: denyAll,
    delete: denyAll,
  },
  admin: {
    useAsTitle: 'event',
    defaultColumns: ['channel', 'event', 'recipient', 'status', 'sentAt'],
    group: 'Engagement',
    description: 'Written by the notification dispatcher. Read-only.',
  },
  fields: [
    {
      name: 'channel',
      type: 'select',
      required: true,
      index: true,
      options: NOTIFICATION_CHANNELS.map((value) => ({ label: value, value })),
    },
    {
      name: 'event',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'The dispatched event name, e.g. “order.shipped”.' },
    },
    {
      name: 'recipient',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Email address or phone number the message went to.' },
    },
    { name: 'templateKey', type: 'text', required: true },
    {
      name: 'payload',
      type: 'json',
      admin: { description: 'Template variables only. Never tokens, card data or a full address.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'queued',
      index: true,
      options: NOTIFICATION_STATUSES.map((value) => ({ label: value, value })),
    },
    {
      name: 'providerId',
      type: 'text',
      index: true,
      admin: { description: 'The provider’s message id. How a delivery webhook finds this row.' },
    },
    { name: 'error', type: 'text', admin: { description: 'Why it failed. A failure never blocks the order flow.' } },
    { name: 'sentAt', type: 'date' },
  ],
}
