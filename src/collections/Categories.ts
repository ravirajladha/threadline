import type { CollectionConfig } from 'payload'

import { publicReadStaffWrite } from '@/access'
import { isActiveField, seoGroup, slugField, sortOrderField } from './fields'
import { SIZE_GROUPS } from '@/types'

/**
 * The category tree — Men → Topwear → Shirts.
 *
 * Self-referencing rather than a fixed two-level hierarchy: clothing catalogues grow sideways
 * (Men → Topwear → Shirts → Formal) and a depth limit would have to be unpicked later.
 *
 * `sizeGroup` lives here, not on the product, because it is a property of the kind of garment:
 * every shirt takes topwear sizes. Products inherit it, which is what lets the bulk variant
 * generator in J2 offer the right sizes without being told.
 */
export const Categories: CollectionConfig = {
  slug: 'categories',
  access: publicReadStaffWrite,
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'parent', 'sizeGroup', 'isActive'],
    group: 'Catalog',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField(),
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      index: true,
      admin: { description: 'Leave empty for a top-level category.' },
    },
    {
      name: 'sizeGroup',
      type: 'select',
      required: true,
      defaultValue: 'topwear',
      options: SIZE_GROUPS.map((value) => ({ label: value, value })),
      admin: { description: 'Which set of sizes products in this category use.' },
    },
    {
      name: 'sizeChart',
      type: 'relationship',
      relationTo: 'sizeCharts',
      admin: { description: 'Shown in the size guide on every product in this category.' },
    },
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'description', type: 'richText' },
    seoGroup(),
    sortOrderField(),
    isActiveField(),
  ],
}
