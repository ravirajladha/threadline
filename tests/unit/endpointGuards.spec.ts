import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { endpoint, json, readJson, requireWrite, routeParam, safeHandler, toId, toIdList } from '@/endpoints/guards'
import { STAFF_ROLES, type StaffRole } from '@/types'

function request(overrides: Partial<Record<string, unknown>> = {}): PayloadRequest {
  return {
    payload: { logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
    user: null,
    routeParams: {},
    ...overrides,
  } as unknown as PayloadRequest
}

function staff(role: StaffRole, isActive = true) {
  return { id: 1, collection: 'users', role, isActive }
}

describe('requireWrite', () => {
  it('lets a role with write through', () => {
    expect(requireWrite(request({ user: staff('catalog_manager') }), 'catalog')).toBeNull()
  })

  it('blocks a role with only read', () => {
    const denied = requireWrite(request({ user: staff('support_agent') }), 'catalog')
    expect(denied?.status).toBe(403)
  })

  it('blocks an anonymous caller', () => {
    expect(requireWrite(request(), 'catalog')?.status).toBe(403)
  })

  it('blocks a customer session, whatever it claims', () => {
    const customer = { id: 9, collection: 'customers', role: 'super_admin' }
    expect(requireWrite(request({ user: customer }), 'catalog')?.status).toBe(403)
  })

  it('blocks a deactivated account', () => {
    expect(requireWrite(request({ user: staff('super_admin', false) }), 'catalog')?.status).toBe(403)
  })

  it('gives the same message whether unauthenticated or unauthorised', async () => {
    // Distinguishing the two tells an attacker which half of the problem to work on.
    const anonymous = await requireWrite(request(), 'catalog')!.json()
    const wrongRole = await requireWrite(request({ user: staff('marketing') }), 'catalog')!.json()

    expect(anonymous).toEqual(wrongRole)
  })

  it('logs the denial for the audit trail', () => {
    const req = request({ user: staff('marketing') })
    requireWrite(req, 'catalog')

    expect(req.payload.logger.warn).toHaveBeenCalled()
  })

  it('matches the matrix across every role', () => {
    for (const role of STAFF_ROLES) {
      const allowed = requireWrite(request({ user: staff(role) }), 'coupons') === null
      expect(allowed).toBe(role === 'super_admin' || role === 'marketing')
    }
  })
})

describe('safeHandler', () => {
  it('passes a successful response through untouched', async () => {
    const response = await safeHandler(() => json({ ok: true }))(request())
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('turns an unexpected throw into a 500 without leaking internals', async () => {
    const boom = (): never => {
      throw new Error('insert into "stock_movements" violates foreign key constraint')
    }

    const req = request()
    const response = await safeHandler(boom)(req)
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(500)
    expect(body.error).not.toContain('stock_movements')
    expect(body.error).not.toContain('constraint')
  })

  it('logs the real error server-side, where it is useful', async () => {
    const req = request()
    await safeHandler(() => {
      throw new Error('the real cause')
    })(req)

    expect(req.payload.logger.error).toHaveBeenCalled()
  })

  it('is applied by the endpoint helper', async () => {
    const built = endpoint('/x', 'post', () => {
      throw new Error('boom')
    })

    const response = await built.handler(request())
    expect((response as Response).status).toBe(500)
  })
})

describe('input narrowing', () => {
  it.each([
    [1, 1],
    ['abc', 'abc'],
    ['  abc  ', 'abc'],
  ])('accepts %j as an id', (input, expected) => {
    expect(toId(input)).toBe(expected)
  })

  it.each([1.5, '', '   ', null, undefined, {}, [], true])('rejects %j as an id', (input) => {
    expect(toId(input)).toBeNull()
  })

  it('keeps only valid ids from a list', () => {
    expect(toIdList([1, 'two', 3.5, null, '', 4])).toEqual([1, 'two', 4])
  })

  it('returns an empty list for a non-array', () => {
    expect(toIdList('1,2,3')).toEqual([])
  })
})

describe('readJson', () => {
  it('returns the parsed object', async () => {
    const req = request({ json: async () => ({ a: 1 }) })
    await expect(readJson(req)).resolves.toEqual({ a: 1 })
  })

  it('returns null on malformed JSON rather than throwing', async () => {
    const req = request({
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    await expect(readJson(req)).resolves.toBeNull()
  })

  it.each([null, 'a string', 42])('returns null for a non-object body %j', async (body) => {
    await expect(readJson(request({ json: async () => body }))).resolves.toBeNull()
  })
})

describe('routeParam', () => {
  it('returns a present parameter', () => {
    expect(routeParam(request({ routeParams: { id: '7' } }), 'id')).toBe('7')
  })

  it.each([{}, { id: '' }, { id: 7 }])('returns null for %j', (routeParams) => {
    expect(routeParam(request({ routeParams }), 'id')).toBeNull()
  })
})
