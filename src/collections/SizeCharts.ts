import type { CollectionConfig } from 'payload'

import { publicReadStaffWrite } from '@/access'
import { SIZE_GROUPS } from '@/types'

/**
 * Body measurements per size, shown in the size-guide modal.
 *
 * Worth its own collection because it is the single highest-leverage thing on a clothing site
 * for reducing returns: a customer who checks a chest measurement before ordering does not
 * send the shirt back. One chart is attached to a category and inherited by every product in it.
 */
export const SizeCharts: CollectionConfig = {
  slug: 'sizeCharts',
  access: publicReadStaffWrite,
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'group'],
    group: 'Catalog',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'group',
      type: 'select',
      required: true,
      options: SIZE_GROUPS.map((value) => ({ label: value, value })),
    },
    {
      name: 'measurements',
      type: 'array',
      required: true,
      minRows: 1,
      admin: { description: 'One row per size, in the order they should appear.' },
      fields: [
        { name: 'sizeLabel', type: 'text', required: true },
        { name: 'chestIn', type: 'number' },
        { name: 'waistIn', type: 'number' },
        { name: 'lengthIn', type: 'number' },
        { name: 'shoulderIn', type: 'number' },
      ],
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'e.g. “Measurements are of the garment, not the body.”' },
    },
  ],
}
