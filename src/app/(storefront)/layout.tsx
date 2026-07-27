/**
 * The storefront shell.
 *
 * Everything persistent lives here rather than in each page: the header with its navigation and
 * bag count, the footer, and the theme script. J3 built those components but nothing mounted
 * them, so every page was rendering as a bare `<main>` — this is where that is corrected.
 *
 * Three deliberate choices:
 *
 * - **`ThemeScript` renders before `children`.** It reads the stored preference and sets the
 *   class synchronously in `<head>`, which is the only way to avoid a flash of the wrong theme;
 *   waiting for `ThemeToggle` to mount is already one paint too late.
 * - **The nav and the bag count are read here, once.** Every page would otherwise fetch the
 *   category list for its own header. `getCatalog` and `getCart` are both `cache`d per request,
 *   so a page that also needs categories shares this read rather than repeating it.
 * - **A skip link.** The header carries a nav list on every page, and without a skip link a
 *   keyboard user tabs through all of it before reaching the product they came for.
 */
import type { Metadata } from 'next'
import React from 'react'

import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { ThemeScript } from '@/components/layout/ThemeToggle'
import { getCatalog } from '@/lib/catalog/server'
import { getCart, readCartSession } from '@/lib/cart/server'

import '@/styles/globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Threadline',
    template: '%s · Threadline',
  },
  description: 'Clothing, considered.',
}

/**
 * How many units are in the bag, for the header badge.
 *
 * Never throws upward: the chrome must render even if the cart cannot be read. A header that
 * takes the whole site down because the `carts` table is unhappy is a worse failure than a
 * missing badge.
 */
async function bagCount(): Promise<number> {
  try {
    const sessionId = await readCartSession()
    if (sessionId === null) return 0

    const cart = await getCart()
    const view = await cart.getCart(sessionId)

    return view.lines.reduce((total, line) => total + line.qty, 0)
  } catch {
    return 0
  }
}

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const catalog = await getCatalog()
  const categories = await catalog.listCategories()

  // Only the top level goes in the header. The rest of the tree is reached from the listing
  // pages, and a nav bar carrying every leaf category is a nav bar nobody reads.
  const topLevel = categories
    .filter((category) => category.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-bg text-fg flex min-h-dvh flex-col antialiased">
        <a
          href="#main"
          className="bg-accent text-accent-fg focus:ring-accent sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-[--radius-control] focus:px-4 focus:py-2 focus:ring-2 focus:outline-none"
        >
          Skip to content
        </a>

        <Header categories={topLevel} bagCount={await bagCount()} />

        <main id="main" className="flex-1">
          {children}
        </main>

        <Footer />
      </body>
    </html>
  )
}
