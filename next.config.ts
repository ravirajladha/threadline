import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

/**
 * Security headers (OWASP A05 — security misconfiguration). J3 is the first stage that serves
 * public pages, so the baseline lands here rather than being retrofitted later.
 *
 * The CSP is built as a directive map, not a hand-joined string, so the dev-only relaxations
 * are easy to see and to remove.
 *
 * **`'unsafe-inline'` in `script-src` is not optional, and it is not dev-only.** This was learned
 * the expensive way: gating it on `NODE_ENV !== 'production'` shipped a deployment where the
 * storefront rendered but was completely inert and `/admin` was a blank page. The App Router
 * streams the React Flight payload to the browser through inline `<script>` blocks
 * (`self.__next_f.push(...)`) — eighteen of them on the home page alone. Blocked, React receives
 * no data, hydration never runs, and the consequences cascade: every `<Link>` degrades to a plain
 * anchor so navigation becomes a full page load, no client component mounts, and Payload's admin
 * — which is bootstrapped entirely by those scripts — paints nothing at all. The HTML was
 * arriving fine the whole time, which is what made it look like a styling or build problem.
 *
 * `'unsafe-eval'` genuinely is dev-only: the HMR client needs it, a production build does not.
 *
 * Honesty over appearing stricter than it is: `script-src` is not nonce-based. A nonce is the
 * right answer and is J9/J10 work, but it is not free — a per-request nonce has to be issued from
 * middleware, which opts every route out of static rendering. That is a caching decision to make
 * alongside the rest of J9, not a header to tighten in isolation.
 */
async function headers() {
  const isProduction = process.env.NODE_ENV === 'production'

  const scriptSrc = ["'self'", "'unsafe-inline'", ...(isProduction ? [] : ["'unsafe-eval'"])]
  const connectSrc = ["'self'", ...(isProduction ? [] : ['ws:', 'http://localhost:*'])]

  const csp: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    // Next's inline bootstrap and Payload's admin styles both rely on inline <style>, in every
    // environment — this is the one relaxation that is not dev-only. See the docblock above.
    'style-src': ["'self'", "'unsafe-inline'"],
    // Product media lives in S3/CloudFront (CLAUDE.md §1); `data:`/`blob:` cover generated
    // previews and the Payload admin's own thumbnails.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connectSrc,
    'frame-ancestors': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  }

  const contentSecurityPolicy = Object.entries(csp)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ')

  return [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
        },
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
      ],
    },
  ]
}

const nextConfig: NextConfig = {
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
  headers,
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
