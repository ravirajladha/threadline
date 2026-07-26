import type { CollectionConfig } from 'payload'

import { denyAll, ownScopedRead, staffWrite } from '@/access'
import { CHAT_ROLES } from '@/types'

/**
 * Transcripts from the Claude-powered assistant.
 *
 * Written only by `/api/chat`, never by a client: `create` and `update` are denied outright, so
 * nobody can forge a conversation or inflate the token counters. The route writes with
 * `overrideAccess` after it has resolved the customer from the session.
 *
 * `tokensIn`/`tokensOut` exist from day one because the spend cap in J7 is only enforceable if
 * usage was being counted before it mattered. `contextUsed` records which catalog and order data
 * was injected into the prompt — the audit trail for "the bot told me something about my order",
 * and the check that the assistant only ever saw the signed-in customer's own data.
 */
export const ChatSessions: CollectionConfig = {
  slug: 'chatSessions',
  access: {
    read: ownScopedRead({ resource: 'support', ownerField: 'customer' }),
    create: denyAll,
    update: denyAll,
    delete: staffWrite('support'),
  },
  admin: {
    useAsTitle: 'sessionId',
    defaultColumns: ['sessionId', 'customer', 'handedOffTo', 'startedAt', 'endedAt'],
    group: 'Engagement',
    description: 'Written by the chat endpoint. Read-only here.',
  },
  fields: [
    { name: 'sessionId', type: 'text', required: true, unique: true, index: true },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      index: true,
      admin: { description: 'Empty for an anonymous visitor — who therefore gets no order data.' },
    },
    {
      name: 'messages',
      type: 'array',
      fields: [
        {
          name: 'role',
          type: 'select',
          required: true,
          options: CHAT_ROLES.map((value) => ({ label: value, value })),
        },
        { name: 'content', type: 'textarea', required: true },
        { name: 'tokensIn', type: 'number', defaultValue: 0 },
        { name: 'tokensOut', type: 'number', defaultValue: 0 },
      ],
    },
    {
      name: 'contextUsed',
      type: 'json',
      admin: { description: 'Which catalog and order data was injected. Never store raw PII here.' },
    },
    {
      name: 'handedOffTo',
      type: 'relationship',
      relationTo: 'tickets',
      admin: { description: 'Set when the assistant escalated to a human.' },
    },
    { name: 'startedAt', type: 'date' },
    { name: 'endedAt', type: 'date' },
  ],
}
