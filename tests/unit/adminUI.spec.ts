import { describe, expect, it } from 'vitest'

import { hiddenUnlessCanRead } from '@/access/adminUI'
import { canRead } from '@/access/permissions'
import { RESOURCE_BY_COLLECTION, collections } from '@/collections'
import { RESOURCES, STAFF_ROLES, type StaffRole } from '@/types'

function staff(role: StaffRole, isActive = true) {
  return { id: 1, collection: 'users', role, isActive }
}

describe('hiddenUnlessCanRead', () => {
  it('shows a resource to a role that can read it', () => {
    expect(hiddenUnlessCanRead('coupons')({ user: staff('marketing') })).toBe(false)
  })

  it('hides a resource from a role that cannot', () => {
    expect(hiddenUnlessCanRead('coupons')({ user: staff('support_agent') })).toBe(true)
  })

  it('hides everything from an anonymous or unresolved session', () => {
    for (const resource of RESOURCES) {
      expect(hiddenUnlessCanRead(resource)({ user: null })).toBe(true)
    }
  })

  it('hides everything from a deactivated account', () => {
    for (const resource of RESOURCES) {
      expect(hiddenUnlessCanRead(resource)({ user: staff('super_admin', false) })).toBe(true)
    }
  })

  it('agrees with the access matrix for every role and resource', () => {
    // The nav is cosmetic, but a nav that disagrees with the access rules is a bug report
    // waiting to happen — a link that 403s, or a hidden page a role can actually use.
    for (const role of STAFF_ROLES) {
      for (const resource of RESOURCES) {
        expect(hiddenUnlessCanRead(resource)({ user: staff(role) })).toBe(!canRead(role, resource))
      }
    }
  })
})

describe('collection resource bindings', () => {
  it('binds every registered collection to a resource', () => {
    const unbound = collections.filter((c) => !RESOURCE_BY_COLLECTION[c.slug])
    expect(unbound.map((c) => c.slug)).toEqual([])
  })

  it('binds nothing that is not a registered collection', () => {
    const slugs = new Set(collections.map((c) => c.slug))
    const stale = Object.keys(RESOURCE_BY_COLLECTION).filter((slug) => !slugs.has(slug))
    expect(stale).toEqual([])
  })

  it('binds only to resources that exist in the matrix', () => {
    for (const resource of Object.values(RESOURCE_BY_COLLECTION)) {
      expect(RESOURCES).toContain(resource)
    }
  })

  it('gives every collection an access block — none left on Payload defaults', () => {
    // OWASP A01. A collection without `access` is readable by anyone Payload considers
    // authenticated, which for a two-auth-collection setup means every customer.
    const undefended = collections.filter((c) => c.access === undefined)
    expect(undefended.map((c) => c.slug)).toEqual([])
  })

  it('declares read, create, update and delete on every collection', () => {
    const incomplete = collections.filter(
      (c) => !c.access?.read || !c.access?.create || !c.access?.update || !c.access?.delete,
    )
    expect(incomplete.map((c) => c.slug)).toEqual([])
  })

  it('hides every collection from the nav for an anonymous session', () => {
    for (const collection of collections) {
      const hidden = collection.admin?.hidden
      expect(typeof hidden).toBe('function')
      expect(typeof hidden === 'function' ? hidden({ user: null as never }) : true).toBe(true)
    }
  })
})
