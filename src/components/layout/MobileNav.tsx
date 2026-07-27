'use client'
// Interactive: opens and closes the mobile navigation drawer.

import { useState } from 'react'
import Link from 'next/link'
import type { CategoryView } from '@/lib/catalog/types'
import { Modal } from '../ui/Modal'
import { MenuIcon } from '../ui/icons'

/**
 * The hamburger trigger and the drawer it opens, self-contained so `Header` can stay a server
 * component — the open/closed state has nowhere else to live.
 *
 * Built on `Modal` rather than a bespoke sheet: a drawer is a dialog anchored to an edge, not a
 * different interaction, and the focus-trap and Escape handling should not be written twice.
 */

export interface MobileNavProps {
  categories: CategoryView[]
}

export function MobileNav({ categories }: MobileNavProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="text-fg hover:bg-surface-raised rounded-control p-2 transition-colors duration-fast ease-out"
      >
        <MenuIcon className="size-6" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Menu"
        className="mr-auto ml-0 h-dvh w-full max-w-xs rounded-none"
        maxHeightVh={100}
      >
        <nav aria-label="Categories">
          <ul className="flex flex-col gap-2">
            <li>
              <Link
                href="/shop"
                onClick={() => setOpen(false)}
                className="text-fg hover:bg-surface-raised block rounded-control px-3 py-2.5 text-base font-medium transition-colors duration-fast ease-out"
              >
                Shop all
              </Link>
            </li>
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/c/${category.slug}`}
                  onClick={() => setOpen(false)}
                  className="text-fg hover:bg-surface-raised block rounded-control px-3 py-2.5 text-base transition-colors duration-fast ease-out"
                >
                  {category.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Modal>
    </div>
  )
}
