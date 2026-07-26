import type { CollectionConfig } from 'payload'

import { allowAll, staffWrite } from '@/access'

/**
 * Uploads — product photography, review photos, ticket attachments.
 *
 * Public to read (a product image is served to anonymous visitors by definition), staff-only to
 * write. The MIME allow-list is the security boundary: without it an upload field is a route to
 * hosting arbitrary files on the store's own origin (OWASP A04).
 */
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: allowAll,
    create: staffWrite('catalog'),
    update: staffWrite('catalog'),
    delete: staffWrite('catalog'),
  },
  admin: {
    group: 'Catalog',
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: {
        description: 'Describes the image for screen readers and SEO. Required.',
      },
    },
  ],
  upload: {
    // OWASP A04 — allow only image types the storefront actually renders.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  },
}
