/**
 * Where the customer is, expressed as a trail.
 *
 * Categories are self-referencing — Menswear → Shirts → Oxford — and an owner reorganising them
 * in the admin can, in a couple of clicks, point a category at one of its own descendants. The
 * data model cannot rule that out cheaply, so the walk here is written to survive it: it tracks
 * the ids it has already seen and stops, returning the chain it managed to build. A miswired
 * category should render an odd breadcrumb, not hang the request that renders it.
 *
 * The walk is deliberately over an in-memory list rather than a query per level. Categories are
 * few and change rarely, so the caller loads them once and every page after that is free.
 */
import type { CategoryView, Crumb } from './types'

/**
 * The chain from the root down to `categoryId`, the category itself last.
 *
 * Returns an empty array when the id is not in the list — an archived or deleted category is not
 * a reason to throw at the top of a page that otherwise renders fine.
 */
export function categoryAncestry(
  categories: readonly CategoryView[],
  categoryId: number,
): CategoryView[] {
  const byId = new Map<number, CategoryView>()
  for (const category of categories) byId.set(category.id, category)

  const chain: CategoryView[] = []
  const seen = new Set<number>()

  let current = byId.get(categoryId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }

  return chain.reverse()
}

/**
 * Ancestors — and optionally the page itself — as a breadcrumb trail.
 *
 * Always starts at Home, and the last crumb is never a link: you do not offer a customer a link
 * to the page they are already reading. That is why `leaf.href` is accepted for symmetry with
 * `Crumb` but is not used — the leaf is, by definition, the current page.
 */
export function buildCrumbs(
  ancestors: readonly CategoryView[],
  leaf?: { title: string; href: string | null },
): Crumb[] {
  const crumbs: Crumb[] = [{ title: 'Home', href: '/' }]

  for (const ancestor of ancestors) {
    crumbs.push({ title: ancestor.title, href: `/c/${ancestor.slug}` })
  }

  if (leaf) crumbs.push({ title: leaf.title, href: leaf.href })

  const lastIndex = crumbs.length - 1
  const last = crumbs[lastIndex]
  if (last) crumbs[lastIndex] = { title: last.title, href: null }

  return crumbs
}
