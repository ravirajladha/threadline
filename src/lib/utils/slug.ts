/**
 * URL slug generation.
 *
 * Slugs are part of the public URL and of the SEO surface, so they are generated once
 * from the title and then owned by the editor — regenerating a live slug would break
 * inbound links. Collections call `slugify` only when the slug field is empty.
 */

/** Combining marks left behind by NFKD decomposition, e.g. the accent in "Été". */
const DIACRITICS = /\p{Diacritic}/gu

/**
 * Lowercase, ASCII-folded, hyphen-separated form of `input`.
 *
 * Accents are decomposed so "Été" becomes "ete"; every other non-alphanumeric run
 * collapses to a single hyphen, and leading/trailing hyphens are trimmed.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A slug guaranteed not to collide with `taken`, by appending `-2`, `-3`, … .
 * Used by the seed script, which creates many products in one pass.
 */
export function uniqueSlug(input: string, taken: readonly string[]): string {
  const base = slugify(input)
  if (!taken.includes(base)) return base

  let suffix = 2
  while (taken.includes(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
