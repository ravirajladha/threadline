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
 * are easy to see and to remove. Two audiences need script laxity that production does not:
 * the Next dev server's HMR client and Payload's admin panel both rely on `unsafe-eval` and
 * `unsafe-inline` for scripts, so those two are gated on `NODE_ENV !== 'production'`. Next's own
 * inline bootstrap script still needs `unsafe-inline` for *styles* even in production — that one
 * is not dev-only.
 *
 * Honesty over appearing stricter than it is: `script-src` is not nonce-based yet. Tightening it
 * to a nonce (dropping `unsafe-inline` for scripts in production) is J9/J10 work, once the admin
 * panel and every inline script on the storefront have been audited for it.
 */
async function headers() {
  const isProduction = process.env.NODE_ENV === 'production'

  const scriptSrc = ["'self'", ...(isProduction ? [] : ["'unsafe-eval'", "'unsafe-inline'"])]
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
