import Link from 'next/link'
import { ThemeToggle } from './ThemeToggle'

/**
 * Static site-wide links plus the theme toggle. Kept a server component — nothing here reacts
 * to anything except `ThemeToggle`, which carries its own client boundary.
 */

const COLUMNS: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
  {
    heading: 'Shop',
    links: [
      { label: 'All products', href: '/shop' },
      { label: 'New in', href: '/shop?sort=newest' },
    ],
  },
  {
    heading: 'Help',
    links: [
      { label: 'Track an order', href: '/account/orders' },
      { label: 'Returns & exchanges', href: '/account/returns' },
      { label: 'Contact us', href: '/support' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Careers', href: '/careers' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy policy', href: '/legal/privacy' },
      { label: 'Terms of service', href: '/legal/terms' },
    ],
  },
]

export function Footer(): React.ReactElement {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.heading} className="flex flex-col gap-3">
              <h3 className="text-fg text-sm font-medium">{column.heading}</h3>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-fg-muted hover:text-fg text-sm transition-colors duration-fast ease-out"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-border mt-12 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
          <p className="text-fg-subtle text-sm">© {new Date().getFullYear()} Threadline. All rights reserved.</p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  )
}
