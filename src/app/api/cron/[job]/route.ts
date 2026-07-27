/**
 * `/api/cron/[job]` — the only way a scheduled job runs.
 *
 * One route for every job, rather than a route per job, because the things that must be true are
 * the same for all of them and writing them four times is writing them three times wrong.
 *
 * - **The secret is required and compared in constant time.** A job runs with no user and full
 *   authority; the secret is the whole of the authentication (`lib/http/cronAuth.ts`).
 * - **A bad secret or an unknown job is a 404, never a 401** (CLAUDE.md §2). The two answer
 *   identically, so the route confirms neither that it exists nor which jobs do. An attacker
 *   probing `/api/cron/refund-everything` learns exactly as much as one probing a typo.
 * - **The job name selects from the registry and nothing else.** A URL segment reaching a handler
 *   is only safe because `findJob` narrows against a closed union first.
 * - **Exactly one job per request**, so a run's counts are attributable and one job's timeout
 *   cannot eat another's budget.
 *
 * The result is returned as JSON counts. That is what makes a cron run auditable from the response
 * — `{ examined: 120, notified: 3 }` is a number the owner can watch drift, where "ok" is not.
 */
import { getPayload } from 'payload'

import config from '@payload-config'
import { isAuthorisedCronRequest } from '@/lib/http/cronAuth'
import { json, safeRoute } from '@/lib/http/route'
import { findJob } from '@/lib/scheduler/registry'
import { runJob } from '@/lib/scheduler/runner'

export const dynamic = 'force-dynamic'

/** The single answer to every rejection. Identical body, identical status, no hint. */
const NOT_FOUND = { error: 'Not found.' }

type Params = Promise<{ job: string }>

async function handle(request: Request, params: Params): Promise<Response> {
  if (!isAuthorisedCronRequest(request.headers, process.env.CRON_SECRET)) {
    return json(NOT_FOUND, 404)
  }

  const { job: name } = await params
  const job = findJob(name)

  if (job === null) return json(NOT_FOUND, 404)

  const payload = await getPayload({ config })
  const result = await runJob(job, { payload, now: new Date() })

  payload.logger.info({ ...result }, 'Scheduled job run')

  // A failed job answers 500 so a scheduler's own alerting sees it, but the body still carries the
  // job name and duration — a monitoring page should not have to read the server log to learn which
  // job broke. `result.error` is a message, never a stack: `runJob` strips that.
  return json(result, result.ok ? 200 : 500)
}

/**
 * `POST` is the real verb — a job mutates.
 *
 * `GET` is accepted as well because several hosted schedulers can only issue one, and refusing
 * would mean the owner writing a shim. The secret is what protects this route, not the method; a
 * job reachable by GET is no weaker than one reachable by POST when neither can be reached without
 * the secret. It is not, however, cacheable: `dynamic` and `no-store` see to that.
 */
export const POST = safeRoute(async (request: Request, context: { params: Params }) =>
  handle(request, context.params),
)

export const GET = POST
