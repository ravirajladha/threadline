import { describe, expect, it } from 'vitest'

import { categoryDescendants, scopeCategoryFilter } from '@/lib/catalog/categoryTree'
import type { CategoryView } from '@/lib/catalog/types'

function category(id: number, slug: string, parentId: number | null = null): CategoryView {
  return {
    id,
    title: slug,
    slug,
    description: null,
    sizeGroup: 'topwear',
    parentId,
    image: null,
    seo: { title: slug, description: null, ogImageUrl: null, canonicalPath: `/c/${slug}` },
    sortOrder: 0,
  }
}

// Men → Topwear → Shirts, with Trousers hanging off Men as a sibling of Topwear.
const MEN = category(1, 'men')
const TOPWEAR = category(2, 'topwear', 1)
const SHIRTS = category(3, 'shirts', 2)
const TROUSERS = category(4, 'trousers', 1)
const WOMEN = category(5, 'women')

const TREE = [MEN, TOPWEAR, SHIRTS, TROUSERS, WOMEN]

describe('categoryDescendants', () => {
  it('returns the root first, then everything under it', () => {
    expect(categoryDescendants(TREE, 1).map((c) => c.slug)).toEqual([
      'men',
      'topwear',
      'trousers',
      'shirts',
    ])
  })

  it('returns just the category when it is a leaf', () => {
    expect(categoryDescendants(TREE, 3).map((c) => c.slug)).toEqual(['shirts'])
  })

  it('does not reach across into a sibling branch', () => {
    expect(categoryDescendants(TREE, 5).map((c) => c.slug)).toEqual(['women'])
  })

  it('returns nothing for an id that is not in the list', () => {
    expect(categoryDescendants(TREE, 99)).toEqual([])
  })

  it('terminates on a cycle rather than recursing for ever', () => {
    // Editable rows can be pointed at each other; the walk must survive it.
    const a = category(10, 'a', 11)
    const b = category(11, 'b', 10)
    expect(categoryDescendants([a, b], 10).map((c) => c.slug)).toEqual(['a', 'b'])
  })

  it('terminates on a category that is its own parent', () => {
    const self = category(20, 'loop', 20)
    expect(categoryDescendants([self], 20).map((c) => c.slug)).toEqual(['loop'])
  })
})

describe('scopeCategoryFilter', () => {
  it('defaults to the whole section when nothing is requested', () => {
    expect(scopeCategoryFilter(TREE, 1, [])).toEqual(['men', 'topwear', 'trousers', 'shirts'])
  })

  it('narrows to the requested sub-category', () => {
    expect(scopeCategoryFilter(TREE, 1, ['shirts'])).toEqual(['shirts'])
  })

  it('ignores a requested category from outside the section', () => {
    // A hand-edited query string must not be a way to show Women's stock under /c/men.
    expect(scopeCategoryFilter(TREE, 1, ['women'])).toEqual([
      'men',
      'topwear',
      'trousers',
      'shirts',
    ])
  })

  it('keeps only the in-scope part of a mixed request', () => {
    expect(scopeCategoryFilter(TREE, 1, ['shirts', 'women'])).toEqual(['shirts'])
  })

  it('returns nothing for an unknown root', () => {
    expect(scopeCategoryFilter(TREE, 99, ['shirts'])).toEqual([])
  })
})
