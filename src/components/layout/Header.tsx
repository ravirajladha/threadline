import Link from 'next/link'
import type { CategoryView } from '@/lib/catalog/types'
import { MobileNav } from './MobileNav'
import { BagIcon, SearchIcon, UserIcon } from '../ui/icons'

/**
 * The storefront's one persistent chrome. Search and account remain inert placeholders until J8;
 * the bag is live from J4 and carries the session's unit count.
 *
 * The count is a **prop, not a fetch**. The header is a server component rendered inside the
 * storefront layout, which already reads the cart once per request — having it read again here
 * would double every page's cart query for a number the layout is holding anyway.
 *
 * The scroll-triggered hairline is the one piece of behaviour a server component cannot own
 * outright. Rather than promoting the whole header to a client component for one border, it
 * carries a small static inline script — the same technique `ThemeScript` uses to beat the
 * paint — that toggles a `data-scrolled` attribute a Tailwind selector reads.
 */

const HAIRLINE_SCRIPT = `(function(){var h=document.getElementById("site-header");if(!h)return;var onScroll=function(){h.setAttribute("data-scrolled",window.scrollY>4?"true":"false");};onScroll();window.addEventListener("scroll",onScroll,{passive:true});})();`

/** Past this the badge reads "9+" rather than stretching the icon out of shape. */
const MAX_BADGE_COUNT = 9

export interface HeaderProps {
  categories: CategoryView[]
  /** Units in the bag. Zero renders the icon with no badge. */
  bagCount?: number
}

export function Header({ categories, bagCount = 0 }: HeaderProps): React.ReactElement {
  return (
    <header
      id="site-header"
      data-scrolled="false"
      // `HAIRLINE_SCRIPT` below runs the moment the browser parses it — before React hydrates —
      // and sets `data-scrolled` from the real scroll position. On a reload that restores scroll,
      // or a deep link to an anchor, that is `"true"` while the server rendered `"false"`, and
      // React reports the difference as a hydration mismatch.
      //
      // Suppressing it is correct rather than a workaround: the attribute is deliberately owned
      // by the DOM, not by React, precisely so the whole header does not have to become a client
      // component for one border. This is the same reason `<html>` carries it for the theme.
      suppressHydrationWarning
      className="bg-bg/95 sticky top-0 z-40 border-b border-transparent backdrop-blur data-[scrolled=true]:border-border"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 sm:px-6">
        <MobileNav categories={categories} />

        <Link href="/" className="text-fg text-xl font-medium tracking-tight">
          Threadline
        </Link>

        <nav aria-label="Categories" className="ml-6 hidden flex-1 md:block">
          <ul className="flex items-center gap-6">
            <li>
              <Link
                href="/shop"
                className="text-fg-muted hover:text-fg text-sm font-medium transition-colors duration-fast ease-out"
              >
                Shop all
              </Link>
            </li>
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/c/${category.slug}`}
                  className="text-fg-muted hover:text-fg text-sm font-medium transition-colors duration-fast ease-out"
                >
                  {category.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/*
            The only `prefetch={false}` in the storefront, and the one place it is warranted.

            `/admin` is Payload's route group with its own root layout, so React cannot navigate
            into it — the browser performs a full document load regardless. Prefetching therefore
            buys nothing, while costing every shopper who merely scrolls past the header a pull of
            the admin bundle: over a megabyte of JavaScript they can never use.
          */}
          <Link
            href="/admin"
            prefetch={false}
            className="text-fg-muted hover:text-fg rounded-control px-2 py-1 text-sm font-medium transition-colors duration-fast ease-out"
          >
            Admin
          </Link>
          <button
            type="button"
            disabled
            aria-label="Search (coming soon)"
            className="text-fg-muted rounded-control p-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SearchIcon className="size-5" />
          </button>
          <button
            type="button"
            disabled
            aria-label="Account (coming soon)"
            className="text-fg-muted rounded-control p-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UserIcon className="size-5" />
          </button>
          <Link
            href="/cart"
            // The count is in the label rather than only in the badge, so it is announced on
            // focus instead of being a number a screen reader reads out with no context.
            aria-label={bagCount > 0 ? `Bag, ${bagCount} item${bagCount === 1 ? '' : 's'}` : 'Bag, empty'}
            className="text-fg-muted hover:text-fg relative rounded-control p-2 transition-colors duration-fast ease-out"
          >
            <BagIcon className="size-5" />
            {bagCount > 0 ? (
              <span
                aria-hidden="true"
                className="bg-accent text-accent-fg absolute top-0.5 right-0.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-medium"
              >
                {bagCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : bagCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      {/* Static script, no user input — see the comment on HAIRLINE_SCRIPT above. */}
      <script dangerouslySetInnerHTML={{ __html: HAIRLINE_SCRIPT }} />
    </header>
  )
}
