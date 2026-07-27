import Link from 'next/link'
import type { CategoryView } from '@/lib/catalog/types'
import { MobileNav } from './MobileNav'
import { BagIcon, SearchIcon, UserIcon } from '../ui/icons'

/**
 * The storefront's one persistent chrome. Search, account and cart are rendered now as inert
 * placeholders — icons with no handler — purely so later stages (J4 cart, J8 account) slot in
 * without reshaping the header around them.
 *
 * The scroll-triggered hairline is the one piece of behaviour a server component cannot own
 * outright. Rather than promoting the whole header to a client component for one border, it
 * carries a small static inline script — the same technique `ThemeScript` uses to beat the
 * paint — that toggles a `data-scrolled` attribute a Tailwind selector reads.
 */

const HAIRLINE_SCRIPT = `(function(){var h=document.getElementById("site-header");if(!h)return;var onScroll=function(){h.setAttribute("data-scrolled",window.scrollY>4?"true":"false");};onScroll();window.addEventListener("scroll",onScroll,{passive:true});})();`

export interface HeaderProps {
  categories: CategoryView[]
}

export function Header({ categories }: HeaderProps): React.ReactElement {
  return (
    <header
      id="site-header"
      data-scrolled="false"
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
          <button
            type="button"
            disabled
            aria-label="Search (coming soon)"
            className="text-fg-muted rounded-[--radius-control] p-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SearchIcon className="size-5" />
          </button>
          <button
            type="button"
            disabled
            aria-label="Account (coming soon)"
            className="text-fg-muted rounded-[--radius-control] p-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UserIcon className="size-5" />
          </button>
          <button
            type="button"
            disabled
            aria-label="Cart (coming soon)"
            className="text-fg-muted rounded-[--radius-control] p-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BagIcon className="size-5" />
          </button>
        </div>
      </div>

      {/* Static script, no user input — see the comment on HAIRLINE_SCRIPT above. */}
      <script dangerouslySetInnerHTML={{ __html: HAIRLINE_SCRIPT }} />
    </header>
  )
}
