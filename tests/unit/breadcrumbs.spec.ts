import { describe, expect, it } from 'vitest'

import { buildCrumbs, categoryAncestry } from '@/lib/catalog/breadcrumbs'
import type { CategoryView } from '@/lib/catalog/types'

function category(id: number, title: string, parentId: number | null): CategoryView {
  const slug = title.toLowerCase().replace(/\s+/g, '-')
  return {
    id,
    title,
    slug,
    description: null,
    sizeGroup: 'topwear',
    parentId,
    image: null,
    seo: { title, description: null, ogImageUrl: null, canonicalPath: `/c/${slug}` },
    sortOrder: 0,
  }
}

const MENSWEAR = category(1, 'Menswear', null)
const SHIRTS = category(2, 'Shirts', 1)
const OXFORD = category(3, 'Oxford', 2)
const TREE = [OXFORD, SHIRTS, MENSWEAR]

describe('categoryAncestry', () => {
  it('walks up to the root and returns the chain root first', () => {
    expect(categoryAncestry(TREE, 3).map((row) => row.title)).toEqual([
      'Menswear',
      'Shirts',
      'Oxford',
    ])
  })

  it('returns a top-level category on its own', () => {
    expect(categoryAncestry(TREE, 1).map((row) => row.title)).toEqual(['Menswear'])
  })

  it('returns nothing for a category that is not in the list', () => {
    // Archived or deleted since the page was built — not a reason to throw.
    expect(categoryAncestry(TREE, 99)).toEqual([])
  })

  it('returns nothing when the list is empty', () => {
    expect(categoryAncestry([], 1)).toEqual([])
  })

  it('stops at a parent that is no longer in the list', () => {
    const orphan = category(4, 'Linen', 77)
    expect(categoryAncestry([orphan], 4).map((row) => row.title)).toEqual(['Linen'])
  })

  it('terminates on a category that is its own parent', () => {
    const looped = category(5, 'Knots', 5)
    expect(categoryAncestry([looped], 5).map((row) => row.title)).toEqual(['Knots'])
  })

  it('terminates on a two-node cycle rather than hanging', () => {
    // An owner reorganising categories can point one at its own descendant in two clicks.
    const a = category(6, 'Loop A', 7)
    const b = category(7, 'Loop B', 6)
    expect(categoryAncestry([a, b], 6).map((row) => row.title)).toEqual(['Loop B', 'Loop A'])
  })

  it('terminates on a longer cycle', () => {
    const a = category(8, 'A', 10)
    const b = category(9, 'B', 8)
    const c = category(10, 'C', 9)
    expect(categoryAncestry([a, b, c], 9).map((row) => row.id)).toEqual([10, 8, 9])
  })
})

describe('buildCrumbs', () => {
  it('starts at Home and links every ancestor to its category page', () => {
    expect(buildCrumbs(categoryAncestry(TREE, 3))).toEqual([
      { title: 'Home', href: '/' },
      { title: 'Menswear', href: '/c/menswear' },
      { title: 'Shirts', href: '/c/shirts' },
      { title: 'Oxford', href: null },
    ])
  })

  it('appends the product as the last crumb', () => {
    const crumbs = buildCrumbs(categoryAncestry(TREE, 2), {
      title: 'Oxford Shirt',
      href: '/p/oxford-shirt',
    })

    expect(crumbs).toEqual([
      { title: 'Home', href: '/' },
      { title: 'Menswear', href: '/c/menswear' },
      { title: 'Shirts', href: '/c/shirts' },
      // You do not link a customer to the page they are already reading.
      { title: 'Oxford Shirt', href: null },
    ])
  })

  it('is just Home when there is no ancestry and no leaf', () => {
    expect(buildCrumbs([])).toEqual([{ title: 'Home', href: null }])
  })

  it('links Home once a second crumb exists', () => {
    expect(buildCrumbs([], { title: 'Shop', href: '/shop' })).toEqual([
      { title: 'Home', href: '/' },
      { title: 'Shop', href: null },
    ])
  })

  it('does not mutate the ancestors it was given', () => {
    const ancestors = categoryAncestry(TREE, 3)
    buildCrumbs(ancestors, { title: 'Oxford Shirt', href: null })
    expect(ancestors.map((row) => row.slug)).toEqual(['menswear', 'shirts', 'oxford'])
  })
})
