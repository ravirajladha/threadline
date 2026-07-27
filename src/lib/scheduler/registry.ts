/**
 * The one job registry.
 *
 * CLAUDE.md's engineering standards call for "one scheduler — a single job registry, not ad-hoc
 * cron entries", and this is it. Two properties earn it its place:
 *
 * **A duplicate job name throws at module load, not at 3am.** Two jobs registered under one name is
 * a mistake that otherwise surfaces as one of them silently never running — the kind of bug that
 * takes a month to notice because nothing fails, something just stops happening.
 *
 * **Lookup by name is the only way a route can reach a handler.** `/api/cron/[job]` takes a string
 * from a URL; if that string could select arbitrary code the route would be a remote execution
 * surface. It maps through this table and nowhere else, so the worst an unknown name can do is
 * return null — which the route turns into a 404 that does not even confirm which jobs exist.
 */
import { abandonedCartJob } from './jobs/abandonedCart'
import { reviewRequestsJob } from './jobs/reviewRequests'
import { statusSyncJob } from './jobs/statusSync'
import { stockAlertsJob } from './jobs/stockAlerts'
import { isJobName, JOB_NAMES, type Job, type JobName } from './types'

export class DuplicateJobError extends Error {
  constructor(name: string) {
    super(`Two jobs are registered as "${name}". A job name must be unique.`)
    this.name = 'DuplicateJobError'
  }
}

export class MissingJobError extends Error {
  constructor(names: readonly string[]) {
    super(`No job is registered for: ${names.join(', ')}. Every JobName needs an implementation.`)
    this.name = 'MissingJobError'
  }
}

/**
 * Build a registry, refusing anything ambiguous or incomplete.
 *
 * Exported separately from the registry itself so both failure modes are testable — a module that
 * throws on import cannot be tested by importing it.
 */
export function createJobRegistry(jobs: readonly Job[]): ReadonlyMap<JobName, Job> {
  const registry = new Map<JobName, Job>()

  for (const job of jobs) {
    if (registry.has(job.name)) throw new DuplicateJobError(job.name)
    registry.set(job.name, job)
  }

  // The union in `types.ts` is the list the cron route validates against, so a name that is
  // advertised there and implemented nowhere would be a 404 with no explanation. Caught at load.
  const missing = JOB_NAMES.filter((name) => !registry.has(name))
  if (missing.length > 0) throw new MissingJobError(missing)

  return registry
}

export const JOB_REGISTRY: ReadonlyMap<JobName, Job> = createJobRegistry([
  abandonedCartJob,
  statusSyncJob,
  stockAlertsJob,
  reviewRequestsJob,
])

/**
 * The job called `name`, or null.
 *
 * Takes `unknown` because its caller holds a URL segment. Narrowing here rather than at the call
 * site is what makes it impossible to reach a handler without passing the check.
 */
export function findJob(name: unknown): Job | null {
  if (!isJobName(name)) return null

  return JOB_REGISTRY.get(name) ?? null
}

/** Every registered job, for an admin screen or a health check. */
export function allJobs(): Job[] {
  return [...JOB_REGISTRY.values()]
}
