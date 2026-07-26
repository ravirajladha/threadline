/**
 * SKU generation.
 *
 * A SKU identifies one sellable variant — a single size in a single colour. The format is
 * `{PRODUCT}-{COLOUR}-{SIZE}`, uppercase, so a warehouse label is readable without a lookup.
 * Generated once on create; editors may override it, and the value is then immutable in
 * practice because it appears on picked orders.
 */
import { slugify } from '@/lib/utils/slug'

/** Longest segment kept from the product title. Keeps labels scannable. */
const PRODUCT_SEGMENT_LENGTH = 12
/** Colours are abbreviated harder — "MIDNIGHT NAVY" is `MIDNI`. */
const COLOUR_SEGMENT_LENGTH = 5

function segment(value: string, maxLength: number): string {
  return slugify(value).replace(/-/g, '').slice(0, maxLength).toUpperCase()
}

/**
 * Build the SKU for one variant.
 *
 * Throws when any part is blank: a variant without a size or colour is not sellable, and a
 * silently truncated SKU would collide with its siblings.
 */
export function buildSku(productTitle: string, colourName: string, sizeLabel: string): string {
  const product = segment(productTitle, PRODUCT_SEGMENT_LENGTH)
  const colour = segment(colourName, COLOUR_SEGMENT_LENGTH)
  const size = segment(sizeLabel, sizeLabel.length)

  if (!product || !colour || !size) {
    throw new RangeError(
      `Cannot build a SKU from product="${productTitle}" colour="${colourName}" size="${sizeLabel}"`,
    )
  }

  return `${product}-${colour}-${size}`
}
