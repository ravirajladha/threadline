import type { CollectionConfig } from 'payload'

import { publicReadStaffWrite } from '@/access'
import { isActiveField, sortOrderField } from './fields'
import { SIZE_GROUPS } from '@/types'

/**
 * The size vocabulary — S, XL, 32, 4-5Y.
 *
 * A collection rather than an enum because the owner adds sizes (a 3XL, a 4-5Y) without a
 * deploy, and because a size needs an explicit order: sorted alphabetically the pills on a
 * product page render "L, M, S, XL", which reads as a bug to every customer who sees it.
 */
export const Sizes: CollectionConfig = {
  slug: 'sizes',
  access: publicReadStaffWrite,
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'group', 'sortOrder', 'isActive'],
    group: 'Catalog',
    description: 'sortOrder is what makes size pills render S, M, L, XL instead of alphabetically.',
  },
  fields: [
    {
      name: 'label',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'As it appears on the size pill: S, XL, 32, 4-5Y.' },
    },
    {
      name: 'group',
      type: 'select',
      required: true,
      index: true,
      options: SIZE_GROUPS.map((value) => ({ label: value, value })),
      admin: { description: 'Must match the category’s size group for the size to be offered.' },
    },
    sortOrderField('Small to large. Required — this is the display order on the product page.'),
    isActiveField(),
  ],
}
