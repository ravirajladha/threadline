/**
 * Shared field builders.
 *
 * Not a collection — these are the field shapes that repeat across collections. A slug, a
 * money amount and an SEO group are defined once here so that "money is integer paise" and
 * "slugs are unique and indexed" are properties of the system rather than habits an author
 * has to remember. CLAUDE.md §3: second use moves to the nearest shared folder.
 */
import type { Field, GroupField, NumberField, TextField } from 'payload'

import { slugify } from '@/lib/utils/slug'

/**
 * URL slug, generated from `sourceField` on first save and then left alone.
 *
 * Regenerating a slug on every title edit would silently break live URLs and every inbound
 * link pointing at them, so once a value exists it is the editor's to change.
 */
export function slugField(sourceField = 'title'): TextField {
  return {
    name: 'slug',
    type: 'text',
    required: true,
    unique: true,
    index: true,
    admin: {
      position: 'sidebar',
      description: 'Appears in the URL. Generated from the title; changing it breaks existing links.',
    },
    hooks: {
      beforeValidate: [
        ({ value, data }) => {
          if (typeof value === 'string' && value.length > 0) return slugify(value)

          const source = data?.[sourceField]
          return typeof source === 'string' ? slugify(source) : value
        },
      ],
    },
  }
}

/**
 * A money amount, stored as integer paise.
 *
 * Never a float: `src/lib/pricing/money.ts` explains why. The admin description says so on
 * every field because that is where a well-meaning editor would otherwise type `499.00`.
 */
export function moneyField(
  name: string,
  options: { label?: string; required?: boolean; description?: string } = {},
): NumberField {
  return {
    name,
    type: 'number',
    required: options.required ?? false,
    min: 0,
    ...(options.label ? { label: options.label } : {}),
    admin: {
      step: 1,
      description: options.description
        ? `${options.description} Amount in paise — ₹499 is 49900.`
        : 'Amount in paise — ₹499 is 49900.',
    },
  }
}

/** Search-engine metadata. Every public-facing collection carries the same group. */
export function seoGroup(): GroupField {
  return {
    name: 'seo',
    type: 'group',
    admin: {
      description: 'Overrides the generated metadata. Leave blank to use the title and description.',
    },
    fields: [
      { name: 'title', type: 'text', maxLength: 70 },
      { name: 'description', type: 'textarea', maxLength: 180 },
      { name: 'ogImage', type: 'upload', relationTo: 'media' },
    ],
  }
}

/** Manual ordering. Lower sorts first — the default of 0 keeps new rows at the top. */
export function sortOrderField(description = 'Lower numbers sort first.'): NumberField {
  return {
    name: 'sortOrder',
    type: 'number',
    defaultValue: 0,
    index: true,
    admin: { position: 'sidebar', description },
  }
}

/** Soft on/off switch. Nothing in this project is deleted when it can be deactivated. */
export function isActiveField(defaultValue = true): Field {
  return {
    name: 'isActive',
    type: 'checkbox',
    defaultValue,
    index: true,
    admin: { position: 'sidebar' },
  }
}

/**
 * A postal address copied onto an order at the moment it is placed.
 *
 * A snapshot, not a relationship: the customer will edit their address book, and an invoice
 * must keep saying where the parcel was actually sent. Joining live data here would rewrite
 * history every time somebody moves house.
 */
export function addressSnapshotGroup(name: 'shippingAddress' | 'billingAddress'): GroupField {
  return {
    name,
    type: 'group',
    admin: { description: 'Copied from the address book when the order was placed. Historical record.' },
    fields: [
      { name: 'name', type: 'text' },
      { name: 'phone', type: 'text' },
      { name: 'line1', type: 'text' },
      { name: 'line2', type: 'text' },
      { name: 'city', type: 'text' },
      { name: 'state', type: 'text' },
      { name: 'pincode', type: 'text' },
      { name: 'country', type: 'text', defaultValue: 'India' },
    ],
  }
}

/**
 * A value the server owns and the admin only displays — stock levels, computed totals.
 * OWASP A04: the client is never the authority on these, so the field is read-only in the
 * UI and recalculated server-side regardless of what arrives in the payload.
 */
export const serverOwned = {
  readOnly: true,
  description: 'Maintained by the system. Not editable.',
} as const
