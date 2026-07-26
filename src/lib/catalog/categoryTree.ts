/**
 * Walking the category tree downward.
 *
 * A customer who opens "Men" expects to see shirts, not an empty page and a list of links —
 * a category listing means the category *and everything under it*. The ancestry walk in
 * `breadcrumbs.ts` goes the other way, up the `parentId` chain; this one goes down, and needs
 * the same protection: a tree assembled from editable rows can contain a cycle, and a recursive
 * descent over one does not come back.
 */
import type { CategoryView } from './types'

/**
 * Every category at or below `rootId`, breadth-first, the root itself first.
 *
 * Returns `[]` when the root is not in the list — an unknown id is a 404 for the caller to
 * handle, not something to paper over by returning the whole catalog.
 */
export function categoryDescendants(
  categories: readonly CategoryView[],
  rootId: number,
): CategoryView[] {
  const root = categories.find((category) => category.id === rootId)
  if (!root) return []

  const childrenOf = new Map<number, CategoryView[]>()
  for (const category of categories) {
    if (category.parentId === null) continue
    const siblings = childrenOf.get(category.parentId)
    if (siblings) siblings.push(category)
    else childrenOf.set(category.parentId, [category])
  }

  const found: CategoryView[] = []
  const visited = new Set<number>()
  const queue: CategoryView[] = [root]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    // The guard is the cycle protection: a row whose parent chain loops back on itself would
    // otherwise be enqueued for ever.
    if (visited.has(current.id)) continue
    visited.add(current.id)

    found.push(current)
    queue.push(...(childrenOf.get(current.id) ?? []))
  }

  return found
}

/**
 * The category slugs a listing for `rootId` should match.
 *
 * When the URL already carries category filters — a customer ticking "Shirts" inside "Men" —
 * they are intersected with the section rather than replacing it, so a hand-edited query string
 * cannot be used to escape the page it is on and show a category from somewhere else entirely.
 */
export function scopeCategoryFilter(
  categories: readonly CategoryView[],
  rootId: number,
  requested: readonly string[],
): string[] {
  const scope = categoryDescendants(categories, rootId).map((category) => category.slug)
  if (requested.length === 0) return scope

  const allowed = new Set(scope)
  const intersection = requested.filter((slug) => allowed.has(slug))

  return intersection.length > 0 ? intersection : scope
}
