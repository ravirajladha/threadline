import type { CollectionConfig } from 'payload'

import { publicReadStaffWrite } from '@/access'
import { moneyField, seoGroup, slugField } from './fields'
import { PRODUCT_STATUSES } from '@/types'

/**
 * A product is a *style*, not something you can buy.
 *
 * "Oxford Shirt" has a description, a fabric and a gallery; what a customer actually adds to
 * a cart is a `variant` — one size in one colour, with its own SKU and stock. Modelling the
 * two levels from the start is the single decision that stops a clothing catalogue from
 * needing a rewrite once it has real inventory in it.
 *
 * `mrp` and `taxRatePct` are defaults inherited by variants that do not override them.
 */
export const Products: CollectionConfig = {
  slug: 'products',
  access: publicReadStaffWrite,
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'status', 'featured'],
    group: 'Catalog',
    description: 'The style. Sizes and colours live in Variants.',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField(),
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
      index: true,
    },
    { name: 'description', type: 'richText' },
    {
      type: 'collapsible',
      label: 'Garment details',
      admin: {
        description: 'The fields customers check before ordering. Filling these in reduces returns.',
      },
      fields: [
        {
          name: 'fabric',
          type: 'text',
          admin: { description: 'e.g. “100% combed cotton, 180 GSM”.' },
        },
        { name: 'careInstructions', type: 'text', admin: { description: 'e.g. “Machine wash cold, do not tumble dry”.' } },
        {
          name: 'fitNotes',
          type: 'text',
          admin: { description: 'e.g. “Relaxed fit — size down for a slimmer look”.' },
        },
      ],
    },
    moneyField('mrp', {
      label: 'MRP',
      required: true,
      description: 'Default selling price for every variant that does not set its own.',
    }),
    {
      name: 'taxRatePct',
      type: 'number',
      required: true,
      defaultValue: 5,
      min: 0,
      max: 100,
      admin: {
        position: 'sidebar',
        description: 'GST slab for this product. Indian apparel is 5% under ₹1000 and 12% above.',
      },
    },
    {
      name: 'gallery',
      type: 'array',
      admin: { description: 'Tag each image with its colour — the gallery filters to the selected swatch.' },
      fields: [
        { name: 'image', type: 'upload', relationTo: 'media', required: true },
        { name: 'colour', type: 'relationship', relationTo: 'colours' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      options: PRODUCT_STATUSES.map((value) => ({ label: value, value })),
      admin: { position: 'sidebar', description: 'Only “active” products appear on the storefront.' },
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: { position: 'sidebar', description: 'Shows in the featured row on the home page.' },
    },
    seoGroup(),
  ],
}
