import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { customerIdOf, customerOrStaffCreate, ownScopedWrite, reviewRead, staffWrite } from '@/access'
import { FIT_FEEDBACK, REVIEW_STATUSES } from '@/types'

/**
 * Stamp the author from the session and force new reviews to `pending`.
 *
 * Both halves matter: without the first a customer could post a review under someone else's
 * name, and without the second they could self-approve by including `status: 'approved'` in
 * the payload. Staff writes are left alone — moderation is exactly the job of changing status.
 */
const stampAuthorAndModerate: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  const customerId = customerIdOf(req.user)
  if (customerId === null) return data
  if (operation !== 'create') return { ...data, status: 'pending' }

  return { ...data, customer: customerId, status: 'pending' }
}

/**
 * Product reviews, with photos and fit feedback.
 *
 * `fitFeedback` is the field that earns its keep on a clothing site: enough "runs small"
 * responses and the product page can warn the next shopper to size up, which prevents the
 * return before it happens.
 *
 * `order` marks a verified purchase. Reviews are moderated — only `approved` ones are public,
 * and a customer additionally sees their own while it waits, so submitting does not look like
 * it silently failed.
 */
export const Reviews: CollectionConfig = {
  slug: 'reviews',
  access: {
    read: reviewRead,
    create: customerOrStaffCreate('support'),
    update: ownScopedWrite({ resource: 'support', ownerField: 'customer' }),
    delete: staffWrite('support'),
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['product', 'rating', 'status', 'customer', 'createdAt'],
    group: 'Engagement',
  },
  hooks: {
    beforeChange: [stampAuthorAndModerate],
  },
  fields: [
    { name: 'product', type: 'relationship', relationTo: 'products', required: true, index: true },
    { name: 'customer', type: 'relationship', relationTo: 'customers', required: true, index: true },
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      admin: { description: 'Present means “verified purchase”.' },
    },
    { name: 'rating', type: 'number', required: true, min: 1, max: 5 },
    { name: 'title', type: 'text' },
    { name: 'body', type: 'textarea', required: true },
    {
      name: 'photos',
      type: 'array',
      fields: [{ name: 'image', type: 'upload', relationTo: 'media', required: true }],
    },
    {
      name: 'fitFeedback',
      type: 'select',
      options: FIT_FEEDBACK.map((value) => ({ label: value, value })),
      admin: { description: 'Aggregated into the sizing hint on the product page.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: REVIEW_STATUSES.map((value) => ({ label: value, value })),
      access: { update: ({ req }) => req.user?.collection === 'users' },
      admin: { position: 'sidebar', description: 'Only “approved” reviews are public.' },
    },
  ],
}
