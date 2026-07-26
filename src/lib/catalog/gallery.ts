/**
 * Which photographs a customer sees, and what happens when the obvious answer is empty.
 *
 * A product's gallery tags each image with the colour it shows, so picking a swatch swaps the
 * photographs. The interesting part is not the filter — it is the fallback. A catalog in progress
 * has products whose images are half tagged, or not tagged at all, and a filter that returns
 * nothing leaves a page with an empty frame where the garment should be. So the chain below never
 * returns a partially filtered set: it tries the colour, then the untagged images, then the whole
 * gallery, and the first rung with anything on it wins.
 *
 * The other decision here is to drop broken entries entirely. An image row whose media is still a
 * bare id, or which has no URL yet, renders as a broken frame — worse than one fewer photograph.
 */
import type { Product } from '@/payload-types'

import type { ImageView } from './types'

/**
 * Gallery rows → renderable images, in the order the owner arranged them.
 *
 * Alt text falls back in three steps, because it is what a screen reader and a search engine
 * actually read: the media's own `alt` when the owner wrote one, then "{product} — {colour}"
 * when the row is tagged with a populated colour, then the product title on its own.
 */
export function toImageViews(gallery: Product['gallery'], productTitle: string): ImageView[] {
  if (!gallery) return []

  const images: ImageView[] = []

  for (const entry of gallery) {
    // A relationship left as an id means the query was not deep enough. Nothing renderable here.
    if (typeof entry.image === 'number') continue

    const media = entry.image
    const url = media.url
    if (typeof url !== 'string' || url.length === 0) continue

    const colour = typeof entry.colour === 'object' && entry.colour !== null ? entry.colour : null
    const mediaAlt = media.alt.trim()

    images.push({
      id: media.id,
      url,
      alt:
        mediaAlt.length > 0
          ? mediaAlt
          : colour
            ? `${productTitle} — ${colour.name}`
            : productTitle,
      width: media.width ?? null,
      height: media.height ?? null,
      colourId: colour?.id ?? null,
    })
  }

  return images
}

/**
 * The images to show for a selected colour.
 *
 * `null` means no colour is selected and everything is shown. Otherwise: images tagged with that
 * colour, or — when the colour has none — the untagged images, or the whole gallery. Each rung is
 * taken whole, so the customer never sees one photograph of the navy shirt and two of the white.
 */
export function galleryFor(images: readonly ImageView[], colourId: number | null): ImageView[] {
  if (colourId === null) return [...images]

  const tagged = images.filter((image) => image.colourId === colourId)
  if (tagged.length > 0) return tagged

  const untagged = images.filter((image) => image.colourId === null)
  if (untagged.length > 0) return untagged

  return [...images]
}
