/**
 * Structured data, embedded safely.
 *
 * This is the one component in the storefront that uses `dangerouslySetInnerHTML`, and it is
 * the reason `escapeJsonLd` exists. Inside a `<script>` element the HTML parser is not looking
 * for JSON — it is looking for the string `</script`, and it will end the element the moment it
 * sees one. A product title containing `</script><img src=x onerror=…>` would therefore break
 * out of the data block and execute, which is stored XSS (OWASP A03).
 *
 * `escapeJsonLd` serialises and then escapes `<`, `>` and `&` into their `\uXXXX` forms, which
 * are valid inside a JSON string, so consumers still parse the same object. The escaping happens
 * at the boundary in `lib/seo`, tested there — this component only ever renders its output, and
 * must never be handed a plain `JSON.stringify` result.
 */
import { escapeJsonLd } from '@/lib/seo/jsonLd'

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // Escaped at the boundary by `escapeJsonLd`; see the docblock above.
      dangerouslySetInnerHTML={{ __html: escapeJsonLd(data) }}
    />
  )
}
