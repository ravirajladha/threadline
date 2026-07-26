import { describe, expect, it } from 'vitest'

import { slugify, uniqueSlug } from '@/lib/utils/slug'

describe('slugify', () => {
  it.each([
    ['Oxford Shirt', 'oxford-shirt'],
    ['  Leading and trailing  ', 'leading-and-trailing'],
    ['Men’s Chinos', 'men-s-chinos'],
    ['Été Collection', 'ete-collection'],
    ['Slim   Fit', 'slim-fit'],
    ['100% Cotton Tee', '100-cotton-tee'],
    ['ALREADY-A-SLUG', 'already-a-slug'],
    ['---', ''],
    ['', ''],
  ])('turns %j into %j', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('is idempotent — slugifying a slug changes nothing', () => {
    const once = slugify('Midnight Navy Oxford Shirt')
    expect(slugify(once)).toBe(once)
  })
})

describe('uniqueSlug', () => {
  it('returns the plain slug when nothing has claimed it', () => {
    expect(uniqueSlug('Oxford Shirt', ['linen-shirt'])).toBe('oxford-shirt')
  })

  it('appends -2 on the first collision', () => {
    expect(uniqueSlug('Oxford Shirt', ['oxford-shirt'])).toBe('oxford-shirt-2')
  })

  it('keeps counting past an existing suffix', () => {
    expect(uniqueSlug('Oxford Shirt', ['oxford-shirt', 'oxford-shirt-2', 'oxford-shirt-3'])).toBe(
      'oxford-shirt-4',
    )
  })

  it('ignores a gap it did not create', () => {
    // -3 is taken but -2 is free, so -2 is the answer. Sequence is not the goal, uniqueness is.
    expect(uniqueSlug('Oxford Shirt', ['oxford-shirt', 'oxford-shirt-3'])).toBe('oxford-shirt-2')
  })
})
