import type { CollectionConfig } from 'payload'

import { denyAll, staffRead, staffWrite } from '@/access'
import { isActiveField, moneyField, serverOwned } from './fields'
import { COUPON_SCOPES, COUPON_TYPES } from '@/types'

/**
 * Discount codes.
 *
 * Not publicly readable — `read` is staff-only on purpose. If the storefront could list this
 * collection, anyone could enumerate every unreleased code; validation happens server-side
 * against a submitted code instead, which is also where the rate limit sits.
 *
 * The limit fields exist because every one of them is a way a coupon gets abused: no minimum
 * cart and a flat discount becomes free shipping on a ₹1 order; no per-user limit and one
 * customer redeems a launch code forty times.
 */
export const Coupons: CollectionConfig = {
  slug: 'coupons',
  access: {
    read: staffRead('coupons'),
    create: staffWrite('coupons'),
    update: staffWrite('coupons'),
    delete: denyAll,
  },
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'type', 'value', 'usedCount', 'endsAt', 'isActive'],
    group: 'Commerce',
    description: 'Never publicly listed. Codes are validated server-side, one at a time.',
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: {
        beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)],
      },
      admin: { description: 'Stored uppercase so “welcome10” and “WELCOME10” are the same coupon.' },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'percent',
      options: COUPON_TYPES.map((value) => ({ label: value, value })),
    },
    {
      name: 'value',
      type: 'number',
      required: true,
      min: 0,
      admin: { description: 'A percentage for “percent”; paise for “flat”; ignored for free shipping.' },
    },
    moneyField('minCartValue', { description: 'Below this the code does not apply.' }),
    moneyField('maxDiscount', { description: 'Caps a percentage discount.' }),
    {
      type: 'collapsible',
      label: 'Usage limits',
      fields: [
        { name: 'limitTotal', type: 'number', min: 0, admin: { description: 'Total redemptions allowed. Empty means unlimited.' } },
        { name: 'limitPerUser', type: 'number', min: 0, defaultValue: 1 },
        {
          name: 'usedCount',
          type: 'number',
          defaultValue: 0,
          admin: { readOnly: serverOwned.readOnly, description: serverOwned.description },
        },
      ],
    },
    { name: 'startsAt', type: 'date' },
    { name: 'endsAt', type: 'date', index: true },
    {
      name: 'appliesTo',
      type: 'select',
      required: true,
      defaultValue: 'all',
      options: COUPON_SCOPES.map((value) => ({ label: value, value })),
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
      admin: { condition: (data) => data?.appliesTo === 'categories' },
    },
    {
      name: 'products',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      admin: { condition: (data) => data?.appliesTo === 'products' },
    },
    {
      name: 'stackable',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Whether this code may be combined with another.' },
    },
    isActiveField(),
  ],
}
