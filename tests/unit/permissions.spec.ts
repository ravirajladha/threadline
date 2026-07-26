import { describe, expect, it } from 'vitest'

import { canRead, canWrite, isStaffRole, permissionFor, readableResources } from '@/access/permissions'
import { RESOURCES, STAFF_ROLES, type PermissionLevel, type Resource, type StaffRole } from '@/types'

/**
 * The policy, transcribed from the role matrix in `docs/SCHEMA.md` rather than from the
 * implementation. That is the whole value of this file: if somebody widens a role in
 * `src/access/permissions.ts`, this table disagrees and the build stops. The two are meant
 * to be edited together, deliberately.
 */
const EXPECTED: Record<StaffRole, Record<Resource, PermissionLevel>> = {
  super_admin: {
    catalog: 'full',
    orders: 'full',
    refunds: 'full',
    support: 'full',
    coupons: 'full',
    customers: 'full',
    users: 'full',
    settings: 'full',
  },
  catalog_manager: {
    catalog: 'full',
    orders: 'read',
    refunds: 'none',
    support: 'none',
    coupons: 'none',
    customers: 'none',
    users: 'none',
    settings: 'none',
  },
  order_manager: {
    catalog: 'read',
    orders: 'full',
    refunds: 'full',
    support: 'read',
    coupons: 'none',
    customers: 'read',
    users: 'none',
    settings: 'none',
  },
  support_agent: {
    catalog: 'read',
    orders: 'read',
    refunds: 'none',
    support: 'full',
    coupons: 'none',
    customers: 'read',
    users: 'none',
    settings: 'none',
  },
  marketing: {
    catalog: 'read',
    orders: 'read',
    refunds: 'none',
    support: 'none',
    coupons: 'full',
    customers: 'none',
    users: 'none',
    settings: 'none',
  },
}

const everyPair = STAFF_ROLES.flatMap((role) => RESOURCES.map((resource) => [role, resource] as const))

describe('permissionFor', () => {
  it.each(everyPair)('%s on %s matches the documented matrix', (role, resource) => {
    expect(permissionFor(role, resource)).toBe(EXPECTED[role][resource])
  })

  it.each([null, undefined, '', 'admin', 'SUPER_ADMIN', 'root', 42, {}])(
    'denies an unrecognised role %j rather than throwing',
    (role) => {
      expect(permissionFor(role as StaffRole, 'orders')).toBe('none')
    },
  )
})

describe('canRead / canWrite', () => {
  it.each(everyPair)('%s on %s — full implies read, and write requires full', (role, resource) => {
    const level = EXPECTED[role][resource]

    expect(canRead(role, resource)).toBe(level === 'read' || level === 'full')
    expect(canWrite(role, resource)).toBe(level === 'full')
  })

  it('never grants write without read', () => {
    for (const [role, resource] of everyPair) {
      if (canWrite(role, resource)) expect(canRead(role, resource)).toBe(true)
    }
  })

  // The non-negotiable cases named in CLAUDE.md §5.
  it('a support_agent cannot mutate orders', () => {
    expect(canRead('support_agent', 'orders')).toBe(true)
    expect(canWrite('support_agent', 'orders')).toBe(false)
  })

  it('a catalog_manager cannot issue refunds', () => {
    expect(canRead('catalog_manager', 'refunds')).toBe(false)
    expect(canWrite('catalog_manager', 'refunds')).toBe(false)
  })

  it('only a super_admin manages staff accounts and settings', () => {
    for (const role of STAFF_ROLES) {
      const expected = role === 'super_admin'
      expect(canWrite(role, 'users')).toBe(expected)
      expect(canWrite(role, 'settings')).toBe(expected)
    }
  })

  it('marketing never sees customer records', () => {
    expect(canRead('marketing', 'customers')).toBe(false)
  })
})

describe('isStaffRole', () => {
  it.each(STAFF_ROLES)('accepts %s', (role) => {
    expect(isStaffRole(role)).toBe(true)
  })

  it.each([null, undefined, 'toString', 'constructor', 'customer', ''])('rejects %j', (value) => {
    expect(isStaffRole(value)).toBe(false)
  })
})

describe('readableResources', () => {
  it('gives a super_admin everything', () => {
    expect(readableResources('super_admin')).toEqual([...RESOURCES])
  })

  it('gives an unauthenticated request nothing', () => {
    expect(readableResources(null)).toEqual([])
  })

  it('gives a marketing user catalog, orders and coupons only', () => {
    expect(readableResources('marketing')).toEqual(['catalog', 'orders', 'coupons'])
  })
})
