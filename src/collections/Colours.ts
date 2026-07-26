import type { CollectionConfig } from 'payload'

import { publicReadStaffWrite } from '@/access'
import { isActiveField, slugField, sortOrderField } from './fields'

/**
 * The colour vocabulary. Drives the swatches on the product page and groups the gallery —
 * picking "Midnight Navy" swaps the images, so a colour is shared reference data rather than
 * free text typed per product, which would give three spellings of the same navy.
 */
export const Colours: CollectionConfig = {
  slug: 'colours',
  access: publicReadStaffWrite,
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'hex', 'sortOrder', 'isActive'],
    group: 'Catalog',
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    slugField('name'),
    {
      name: 'hex',
      type: 'text',
      required: true,
      validate: (value: string | null | undefined) =>
        typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
          ? true
          : 'Enter a six-digit hex colour, for example #1b2a4a.',
      admin: { description: 'The swatch colour, e.g. #1b2a4a.' },
    },
    sortOrderField(),
    isActiveField(),
  ],
}
