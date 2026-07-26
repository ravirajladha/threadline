/**
 * Structured data builders (schema.org via JSON-LD).
 *
 * `escapeJsonLd` is a security boundary, not a formatting nicety (OWASP A03). Structured data
 * is embedded as `<script type="application/ld+json">{escapeJsonLd(data)}</script>`, and that
 * script tag is parsed by the *HTML* parser before anything touches it as JSON: the HTML parser
 * is scanning for the literal byte sequence `</script`, full stop, no matter what string context
 * it appears in. A product title of `</script><img src=x onerror=alert(1)>` stored verbatim and
 * passed through `JSON.stringify` — which does not escape `<` — closes the script tag early and
 * the rest is rendered, and runs, as HTML. Escaping `<`, `>` and `&` to their `\uXXXX` forms
 * defuses that while staying valid JSON (these are ordinary Unicode escapes), so the browser's
 * JSON parser reconstructs the original string unharmed on the other side. The line/paragraph
 * separators U+2028 and U+2029 ride along for a different reason: they are valid JSON but
 * illegal unescaped inside a `<script>` body in some engines, so left raw they can truncate the
 * script instead of just mis-rendering it.
 */
import type { Crumb, ProductDetailView } from '@/lib/catalog/types'

import { absoluteUrl, siteUrl, SITE_NAME } from './metadata'

export function escapeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Drops keys whose value is `undefined` so optional fields never appear as literal nulls. */
function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T
}

/** Paise → the decimal rupee string schema.org's `price` wants, e.g. `499900` → `"4999.00"`. */
function rupeeString(paise: number): string {
  return (paise / 100).toFixed(2)
}

export function productJsonLd(product: ProductDetailView): Record<string, unknown> {
  const images = product.images.map((image) => absoluteUrl(image.url))
  const isInStock = product.variants.some((variant) => variant.isAvailable)
  const availability = isInStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
  const isSinglePrice = product.priceRange.minPaise === product.priceRange.maxPaise

  // A flat-price product gets a single Offer; a product whose variants span a price range (a
  // jacket with a premium colourway, say) gets an AggregateOffer instead — schema.org's
  // distinction, not an arbitrary one, and search engines validate against it.
  const offers = isSinglePrice
    ? stripUndefined({
        '@type': 'Offer',
        url: absoluteUrl(product.seo.canonicalPath),
        price: rupeeString(product.priceRange.minPaise),
        priceCurrency: 'INR',
        availability,
        itemCondition: 'https://schema.org/NewCondition',
      })
    : stripUndefined({
        '@type': 'AggregateOffer',
        url: absoluteUrl(product.seo.canonicalPath),
        lowPrice: rupeeString(product.priceRange.minPaise),
        highPrice: rupeeString(product.priceRange.maxPaise),
        priceCurrency: 'INR',
        offerCount: product.variants.length,
        availability,
        itemCondition: 'https://schema.org/NewCondition',
      })

  return stripUndefined({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    // ProductDetailView.description is Lexical rich text with no plain-text projection here;
    // the SEO description is already the plain-text summary an owner wrote for exactly this
    // purpose, so it stands in rather than pulling the rich-text serialiser into this module.
    description: product.seo.description ?? undefined,
    sku: product.variants[0]?.sku,
    image: images.length > 0 ? images : undefined,
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers,
  })
}

export function breadcrumbJsonLd(crumbs: readonly Crumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) =>
      // The last crumb is the current page — the catalog contract's convention for it is
      // `href: null`, and schema.org's is to list it with a position and name but no `item` URL.
      stripUndefined({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.title,
        item: crumb.href ? absoluteUrl(crumb.href) : undefined,
      }),
    ),
  }
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: siteUrl(),
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${absoluteUrl('/shop')}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

export function organisationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: siteUrl(),
  }
}
