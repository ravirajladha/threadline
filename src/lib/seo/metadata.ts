/**
 * Metadata builders for the storefront (CLAUDE.md J3 — "SEO from the first page").
 *
 * Two decisions worth writing down, because both are easy to get subtly wrong and hard to
 * notice once wrong:
 *
 * 1. `buildMetadata` never appends `SITE_NAME` to a title. The storefront root layout sets
 *    `title: { template: '%s · Threadline', default: 'Threadline' }`, so every page under it
 *    only supplies its own bare title — Next composes the rest. Appending the site name here
 *    too would double it up on every single page.
 *
 * 2. A filtered or re-sorted category listing is not a page worth indexing on its own: it is a
 *    permutation of the same catalogue that a canonical query-string ordering could produce in
 *    any of several equivalent ways. Every permutation therefore canonicalises to the clean
 *    category (or `/shop`) URL and is marked `noindex, follow` — crawled for its product links,
 *    never competing with the clean URL for a ranking. Only the default view of page 1 is
 *    self-canonical and indexable. See `categoryMetadata` and `listingMetadata`.
 */
import type { Metadata } from 'next'

import { DEFAULT_SORT, type CatalogFilters, type CategoryView, type ProductDetailView } from '@/lib/catalog/types'

export const SITE_NAME = 'Threadline'

const DEFAULT_SITE_URL = 'http://localhost:3000'
const MAX_DESCRIPTION_LENGTH = 160

/**
 * The one place that reads `NEXT_PUBLIC_SITE_URL`. Always returns an absolute origin with no
 * trailing slash, so every caller can concatenate a leading-slash path without checking for a
 * double slash first.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const base = configured && configured.length > 0 ? configured : DEFAULT_SITE_URL
  return base.endsWith('/') ? base.slice(0, -1) : base
}

/**
 * Joins a path onto `siteUrl()`. Idempotent for input that is already absolute — callers pass
 * through values that sometimes originate as a full URL (an S3/CloudFront asset) and sometimes
 * as a site-relative path (a canonical), and should not need to know which before calling this.
 */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`
  return `${siteUrl()}${withLeadingSlash}`
}

/**
 * Cuts to 160 characters at a word boundary rather than mid-word, then marks the cut with an
 * ellipsis. Search engines truncate longer descriptions anyway; doing it ourselves means the
 * cut point is always a whole word, not whatever character happened to land on the limit.
 */
function truncateDescription(description: string): string {
  const trimmed = description.trim()
  if (trimmed.length <= MAX_DESCRIPTION_LENGTH) return trimmed

  const cut = trimmed.slice(0, MAX_DESCRIPTION_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  const atWordBoundary = lastSpace > 0 ? cut.slice(0, lastSpace) : cut
  return `${atWordBoundary.trimEnd()}…`
}

export interface BuildMetadataInput {
  /** Bare page title — never include "Threadline"; the layout template adds it. */
  title: string
  description?: string | null
  /** Absolute-path canonical, e.g. `/p/oxford-shirt` or `/c/shirts?page=2`. */
  canonicalPath: string
  ogImageUrl?: string | null
  noIndex?: boolean
  type?: 'website' | 'article'
}

/** The one function every other builder in this file funnels through. */
export function buildMetadata(input: BuildMetadataInput): Metadata {
  const { title, description, canonicalPath, ogImageUrl, noIndex = false, type = 'website' } = input
  const canonical = absoluteUrl(canonicalPath)
  const cleanDescription = description ? truncateDescription(description) : undefined
  const ogImage = ogImageUrl ? absoluteUrl(ogImageUrl) : undefined

  return {
    title,
    description: cleanDescription,
    alternates: { canonical },
    robots: noIndex
      ? { index: false, follow: true }
      : { index: true, follow: true },
    openGraph: {
      title,
      description: cleanDescription,
      url: canonical,
      siteName: SITE_NAME,
      type,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: cleanDescription,
      images: ogImage ? [ogImage] : undefined,
    },
  }
}

export function productMetadata(product: ProductDetailView): Metadata {
  return buildMetadata({
    title: product.seo.title,
    description: product.seo.description,
    canonicalPath: product.seo.canonicalPath,
    ogImageUrl: product.seo.ogImageUrl,
  })
}

/**
 * True when `filters` describes anything other than the catalogue's own default order — any
 * facet narrows the result set, and a non-default sort reorders it. Either way the URL is a
 * permutation, not a distinct page. Shared between `categoryMetadata` and `listingMetadata` so
 * the two can't drift on what counts as "filtered".
 */
function hasNonDefaultFacets(filters: CatalogFilters): boolean {
  return (
    filters.sizes.length > 0 ||
    filters.colours.length > 0 ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.inStockOnly ||
    filters.sort !== DEFAULT_SORT
  )
}

export function categoryMetadata(category: CategoryView, filters: CatalogFilters): Metadata {
  const cleanPath = category.seo.canonicalPath
  const base = {
    title: category.seo.title,
    description: category.seo.description,
    ogImageUrl: category.seo.ogImageUrl,
  }

  // Any facet or a non-default sort is a permutation of this category's catalogue — point the
  // canonical at the clean URL and stay out of the index, per the module docblock.
  if (hasNonDefaultFacets(filters)) {
    return buildMetadata({ ...base, canonicalPath: cleanPath, noIndex: true })
  }

  // Page 2+ of the default view is real, crawlable content — but indexing it alongside page 1
  // would be near-duplicate content competing for the same query, so it stays self-canonical
  // (not folded into page 1, which would make it disappear from the index entirely) and noindex.
  if (filters.page > 1) {
    return buildMetadata({
      ...base,
      canonicalPath: `${cleanPath}?page=${filters.page}`,
      noIndex: true,
    })
  }

  return buildMetadata({ ...base, canonicalPath: cleanPath, noIndex: false })
}

/** Same canonicalisation rules as `categoryMetadata`, for the cross-category `/shop` listing. */
export function listingMetadata(filters: CatalogFilters): Metadata {
  const cleanPath = '/shop'
  const base = {
    title: 'Shop All',
    description: 'Browse the full Threadline catalogue.',
  }
  const filtered = hasNonDefaultFacets(filters) || filters.categories.length > 0

  if (filtered) {
    return buildMetadata({ ...base, canonicalPath: cleanPath, noIndex: true })
  }

  if (filters.page > 1) {
    return buildMetadata({
      ...base,
      canonicalPath: `${cleanPath}?page=${filters.page}`,
      noIndex: true,
    })
  }

  return buildMetadata({ ...base, canonicalPath: cleanPath, noIndex: false })
}
