import { describe, expect, it } from 'vitest'
import type { Access } from 'payload'

import {
  anyStaff,
  customerSelfOrStaff,
  customerOrStaffCreate,
  denyAll,
  ownScopedRead,
  ownScopedWrite,
  reviewRead,
  staffRead,
  staffSelfOrUsersWrite,
  staffWrite,
  superAdminOnly,
} from '@/access'
import { customerIdOf, isCustomer, isStaff, staffRoleOf } from '@/access/actor'
import { STAFF_ROLES, type StaffRole } from '@/types'

// --- Fixtures ---------------------------------------------------------------

const STAFF_ID = 7
const CUSTOMER_ID = 42
const OTHER_CUSTOMER_ID = 43

function staff(role: StaffRole, overrides: Record<string, unknown> = {}) {
  return { id: STAFF_ID, collection: 'users', role, isActive: true, ...overrides }
}

function customer(id: number = CUSTOMER_ID) {
  return { id, collection: 'customers' }
}

/**
 * Call a Payload access function with the minimum it actually reads. Payload's request object
 * is large and mostly irrelevant here — the rules only ever touch `req.user`, which is exactly
 * why they are testable without a database or a running server.
 */
function evaluate(rule: Access, user: unknown) {
  return rule({ req: { user } } as unknown as Parameters<Access>[0])
}

// --- Actor resolution -------------------------------------------------------

describe('actor resolution', () => {
  it('reads the role off a staff session', () => {
    expect(staffRoleOf(staff('order_manager'))).toBe('order_manager')
    expect(isStaff(staff('marketing'))).toBe(true)
  })

  it('treats a deactivated staff account as having no role at all', () => {
    expect(staffRoleOf(staff('super_admin', { isActive: false }))).toBeNull()
    expect(isStaff(staff('super_admin', { isActive: false }))).toBe(false)
  })

  it('refuses a role claimed by a customer session', () => {
    // The whole point of two auth collections: a storefront token cannot carry a staff role.
    expect(staffRoleOf({ id: 1, collection: 'customers', role: 'super_admin' })).toBeNull()
  })

  it('refuses a role that is not in the matrix', () => {
    expect(staffRoleOf(staff('root' as StaffRole))).toBeNull()
  })

  it('identifies a customer, and only from the customers collection', () => {
    expect(customerIdOf(customer())).toBe(CUSTOMER_ID)
    expect(customerIdOf(staff('support_agent'))).toBeNull()
    expect(isCustomer(null)).toBe(false)
  })

  it.each([null, undefined, 'a-string', 0, []])('treats %j as anonymous', (value) => {
    expect(staffRoleOf(value)).toBeNull()
    expect(customerIdOf(value)).toBeNull()
  })
})

// --- Primitives -------------------------------------------------------------

describe('primitives', () => {
  it('denyAll denies a super_admin too — append-only means append-only', () => {
    expect(evaluate(denyAll, staff('super_admin'))).toBe(false)
  })

  it('superAdminOnly admits nobody else', () => {
    for (const role of STAFF_ROLES) {
      expect(evaluate(superAdminOnly, staff(role))).toBe(role === 'super_admin')
    }
  })

  it('anyStaff admits every active role and no customer', () => {
    for (const role of STAFF_ROLES) expect(evaluate(anyStaff, staff(role))).toBe(true)
    expect(evaluate(anyStaff, customer())).toBe(false)
    expect(evaluate(anyStaff, null)).toBe(false)
  })
})

// --- Staff, by resource -----------------------------------------------------

describe('staff access by resource', () => {
  it('a support_agent may read orders and may not write them', () => {
    expect(evaluate(staffRead('orders'), staff('support_agent'))).toBe(true)
    expect(evaluate(staffWrite('orders'), staff('support_agent'))).toBe(false)
  })

  it('a catalog_manager may not touch refunds at all', () => {
    expect(evaluate(staffRead('refunds'), staff('catalog_manager'))).toBe(false)
    expect(evaluate(staffWrite('refunds'), staff('catalog_manager'))).toBe(false)
  })

  it('a marketing user owns coupons and nothing else that mutates', () => {
    expect(evaluate(staffWrite('coupons'), staff('marketing'))).toBe(true)
    expect(evaluate(staffWrite('catalog'), staff('marketing'))).toBe(false)
    expect(evaluate(staffWrite('orders'), staff('marketing'))).toBe(false)
  })

  it('a deactivated super_admin can no longer write anything', () => {
    const suspended = staff('super_admin', { isActive: false })
    expect(evaluate(staffWrite('catalog'), suspended)).toBe(false)
    expect(evaluate(staffRead('catalog'), suspended)).toBe(false)
  })

  it('a customer never satisfies a staff rule', () => {
    expect(evaluate(staffRead('catalog'), customer())).toBe(false)
  })
})

// --- Customer scoping -------------------------------------------------------

describe('ownScopedRead', () => {
  const readOrders = ownScopedRead({ resource: 'orders', ownerField: 'customer' })

  it('scopes a customer to a query matching only their own rows', () => {
    expect(evaluate(readOrders, customer())).toEqual({ customer: { equals: CUSTOMER_ID } })
  })

  it('scopes each customer to themselves and never to another', () => {
    expect(evaluate(readOrders, customer(OTHER_CUSTOMER_ID))).toEqual({
      customer: { equals: OTHER_CUSTOMER_ID },
    })
  })

  it('gives staff with read on the resource an unscoped true', () => {
    expect(evaluate(readOrders, staff('support_agent'))).toBe(true)
  })

  it('denies an anonymous request outright', () => {
    expect(evaluate(readOrders, null)).toBe(false)
  })

  it('scopes across a relationship for order lines', () => {
    const readItems = ownScopedRead({ resource: 'orders', ownerField: 'order.customer' })
    expect(evaluate(readItems, customer())).toEqual({ 'order.customer': { equals: CUSTOMER_ID } })
  })
})

describe('ownScopedWrite', () => {
  const writeOrders = ownScopedWrite({ resource: 'orders', ownerField: 'customer' })

  it('requires write, not read — a support_agent reading orders cannot edit them', () => {
    expect(evaluate(writeOrders, staff('support_agent'))).toBe(false)
    expect(evaluate(writeOrders, staff('order_manager'))).toBe(true)
  })

  it('still scopes a customer to their own rows', () => {
    expect(evaluate(writeOrders, customer())).toEqual({ customer: { equals: CUSTOMER_ID } })
  })
})

describe('customerOrStaffCreate', () => {
  const createTicket = customerOrStaffCreate('support')

  it('lets any signed-in customer raise one', () => {
    expect(evaluate(createTicket, customer())).toBe(true)
  })

  it('lets staff with write on the resource create one', () => {
    expect(evaluate(createTicket, staff('support_agent'))).toBe(true)
  })

  it('refuses staff without write — a marketing user cannot open a ticket', () => {
    expect(evaluate(createTicket, staff('marketing'))).toBe(false)
  })

  it('refuses an anonymous request', () => {
    expect(evaluate(createTicket, null)).toBe(false)
  })
})

// --- Auth collections -------------------------------------------------------

describe('account self-service', () => {
  it('lets a staff member edit their own row without granting them the collection', () => {
    expect(evaluate(staffSelfOrUsersWrite, staff('marketing'))).toEqual({ id: { equals: STAFF_ID } })
  })

  it('gives a super_admin the whole collection', () => {
    expect(evaluate(staffSelfOrUsersWrite, staff('super_admin'))).toBe(true)
  })

  it('scopes a customer to their own account row', () => {
    expect(evaluate(customerSelfOrStaff, customer())).toEqual({ id: { equals: CUSTOMER_ID } })
  })

  it('does not let a marketing user browse customer records', () => {
    expect(evaluate(customerSelfOrStaff, staff('marketing'))).toBe(false)
  })

  it('lets a support_agent read customer records', () => {
    expect(evaluate(customerSelfOrStaff, staff('support_agent'))).toBe(true)
  })
})

// --- Reviews ----------------------------------------------------------------

describe('reviewRead', () => {
  it('shows an anonymous visitor approved reviews only', () => {
    expect(evaluate(reviewRead, null)).toEqual({ status: { equals: 'approved' } })
  })

  it('additionally shows a customer their own pending review', () => {
    expect(evaluate(reviewRead, customer())).toEqual({
      or: [{ status: { equals: 'approved' } }, { customer: { equals: CUSTOMER_ID } }],
    })
  })

  it('shows a support_agent everything awaiting moderation', () => {
    expect(evaluate(reviewRead, staff('support_agent'))).toBe(true)
  })

  it('does not let a catalog_manager moderate — support owns reviews', () => {
    expect(evaluate(reviewRead, staff('catalog_manager'))).toEqual({ status: { equals: 'approved' } })
  })
})
