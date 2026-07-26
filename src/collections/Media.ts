import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    // Product imagery is public by design; writes are restricted in J1 by role.
    read: () => true,
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
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml'],
  },
}
