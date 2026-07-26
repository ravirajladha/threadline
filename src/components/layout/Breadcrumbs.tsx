import Link from 'next/link'
import type { Crumb } from '@/lib/catalog/types'

/**
 * Ancestry, not just a back link — a category page under two parents shows all three. The
 * contract guarantees the last crumb has `href: null`, so it is the one place this component
 * renders text instead of a link, marked `aria-current` for the page it is standing on.
 */

export interface BreadcrumbsProps {
  crumbs: Crumb[]
}

export function Breadcrumbs({ crumbs }: BreadcrumbsProps): React.ReactElement | null {
  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="text-fg-muted overflow-x-auto text-sm">
      <ol className="flex items-center gap-2 whitespace-nowrap">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.title}-${index}`} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-fg-subtle">
                /
              </span>
            ) : null}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-fg transition-colors duration-fast ease-out">
                {crumb.title}
              </Link>
            ) : (
              <span aria-current="page" className="text-fg">
                {crumb.title}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
