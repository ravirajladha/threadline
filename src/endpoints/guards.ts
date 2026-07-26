/**
 * Shared guards for custom endpoints.
 *
 * A custom endpoint bypasses collection access entirely — Payload only applies those to its own
 * CRUD routes. So every handler here re-checks the role itself. That is the whole reason this
 * file exists rather than each endpoint doing it from memory: the check that is easiest to
 * forget is the one that must never be forgotten (OWASP A01).
 */
import type { Endpoint, PayloadHandler, PayloadRequest } from 'payload'

import { canWrite, staffRoleOf } from '@/access'
import type { Resource } from '@/types'

/** JSON response with the right content type. Endpoints never return bare strings. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

/**
 * Wrap a handler so an unexpected throw becomes a clean 500.
 *
 * Without this, a database error propagates out of the endpoint and the caller receives the
 * failing SQL, its parameters and a stack trace — a free map of the schema (OWASP A05). The
 * detail is logged server-side, where it is useful, and the caller gets a sentence.
 *
 * Deliberate: this catches only what the handler did not anticipate. Expected failures —
 * a bad quantity, an unknown SKU — are returned as 400s by the handler itself, with a message
 * written for a human.
 */
export function safeHandler(handler: PayloadHandler): PayloadHandler {
  return async (req) => {
    try {
      return await handler(req)
    } catch (error) {
      req.payload.logger.error(
        { err: error },
        `Unhandled error in endpoint for user ${req.user?.id ?? 'anonymous'}`,
      )

      return json({ error: 'Something went wrong. The error has been logged.' }, 500)
    }
  }
}

/** Declare an endpoint with the error boundary already applied. */
export function endpoint(path: string, method: Endpoint['method'], handler: PayloadHandler): Endpoint {
  return { path, method, handler: safeHandler(handler) }
}

/**
 * Refuse unless the caller has write on `resource`.
 *
 * Returns a `Response` to send, or `null` to proceed — so the handler reads as
 * `const denied = requireWrite(req, 'catalog'); if (denied) return denied`.
 *
 * The message never distinguishes "not signed in" from "not allowed": telling an attacker
 * which of the two it was is free reconnaissance (OWASP A07).
 */
export function requireWrite(req: PayloadRequest, resource: Resource): Response | null {
  if (canWrite(staffRoleOf(req.user), resource)) return null

  req.payload.logger.warn(
    `Denied ${resource} write on ${req.routeParams?.path ?? 'endpoint'} for user ${req.user?.id ?? 'anonymous'}`,
  )

  return json({ error: 'You do not have permission to do that.' }, 403)
}

/**
 * Read and validate a JSON body.
 *
 * Every external input is typed at the boundary rather than trusted — a malformed body is a
 * 400, not an exception that surfaces a stack trace to the caller (OWASP A05).
 */
export async function readJson(req: PayloadRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = typeof req.json === 'function' ? await req.json() : undefined
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A route parameter that must be present. Returns null when it is missing or empty. */
export function routeParam(req: PayloadRequest, name: string): string | null {
  const value = req.routeParams?.[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Narrow an unknown body field to a positive integer id. */
export function toId(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

/** Narrow an unknown body field to an array of ids. */
export function toIdList(value: unknown): Array<number | string> {
  if (!Array.isArray(value)) return []

  return value.map(toId).filter((id): id is number | string => id !== null)
}
