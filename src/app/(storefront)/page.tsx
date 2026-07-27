/**
 * `/` — the storefront's front door.
 *
 * Replaces the J0 placeholder that was still standing here. Three bands, each answering one
 * question a first-time visitor has: what is this, what does it look like, and where do I start.
 *
 * Everything on the page is composed from what J3 already built — `ProductGrid` renders the same
 * `ProductCardView` the listing pages use, so a change to how a product card reads happens once.
 * The home page deliberately owns no new view model of its own.
 *
 * The "new in" band is the newest arrivals rather than a hand-picked selection, because a
 * curated one needs a `featured` flag on the product and somewhere in the admin to set it —
 * that is a feature to spec in `docs/FEATURES.md`, not a literal in a page component.
 */
import Link from 'next/link'

import { ProductGrid } from '@/components/catalog/ProductGrid'
import { JsonLd } from '@/components/seo/JsonLd'
import { EMPTY_FILTERS } from '@/lib/catalog/types'
import { getCatalog } from '@/lib/catalog/server'
import { websiteJsonLd } from '@/lib/seo/jsonLd'

/** How many arrivals the band shows. Two full rows at the widest grid. */
const NEW_IN_COUNT = 8

export default async function HomePage() {
  const catalog = await getCatalog()

  const [listing, categories] = await Promise.all([
    catalog.listProducts({ ...EMPTY_FILTERS, sort: 'newest' }),
    catalog.listCategories(),
  ])

  const newIn = listing.products.slice(0, NEW_IN_COUNT)

  /*
   * The browse band shows **leaf** categories, not top-level ones.
   *
   * The header navigates the tree from its root, which is right for navigation. This band is a
   * shortcut into the catalog, and the sections that hold garments are the leaves — "Shirts",
   * "T-Shirts", "Chinos", not the "Men" that contains them. With the current catalog, filtering
   * to roots renders exactly one card, which reads as a broken grid rather than a sparse one.
   *
   * Falling back to the whole list matters: a flat catalog with no nesting has no leaves by this
   * definition, and an empty band would be worse than an unfiltered one.
   */
  const hasChildren = new Set(
    categories.map((category) => category.parentId).filter((id): id is number => id !== null),
  )
  const leaves = categories.filter((category) => !hasChildren.has(category.id))
  const browsable = (leaves.length > 0 ? leaves : categories).sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <>
      <JsonLd data={websiteJsonLd()} />

      <section className="border-border border-b">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
          <p className="text-accent mb-4 text-sm font-medium tracking-[0.2em] uppercase">Threadline</p>
          <h1 className="text-fg max-w-3xl text-4xl leading-[1.1] font-medium tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Clothing, considered.
          </h1>
          <p className="text-fg-muted mt-6 max-w-prose text-lg">
            Pieces chosen for how they wear, not how quickly they sell. Every size and colour, with
            what is actually in stock shown before you reach the bag.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/shop"
              className="bg-accent text-accent-fg hover:bg-accent-hover rounded-control px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out"
            >
              Shop the collection
            </Link>
          </div>
        </div>
      </section>

      {browsable.length > 0 ? (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <h2 className="text-fg mb-6 text-2xl font-medium tracking-tight">Browse</h2>
          <ul role="list" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {browsable.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/c/${category.slug}`}
                  className="border-border hover:border-accent group flex items-center justify-between rounded-card border p-5 transition-colors duration-fast ease-out"
                >
                  <span className="text-fg text-base font-medium">{category.title}</span>
                  <span
                    aria-hidden="true"
                    className="text-fg-subtle group-hover:text-accent transition-colors duration-fast ease-out"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {newIn.length > 0 ? (
        <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h2 className="text-fg text-2xl font-medium tracking-tight">New in</h2>
            <Link
              href="/shop?sort=newest"
              className="text-fg-muted hover:text-fg text-sm transition-colors duration-fast ease-out"
            >
              View all
            </Link>
          </div>
          <ProductGrid products={newIn} />
        </section>
      ) : null}
    </>
  )
}
