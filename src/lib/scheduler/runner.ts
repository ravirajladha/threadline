/**
 * Running one job.
 *
 * Small, but it is the difference between a scheduler and four fragile route handlers:
 *
 * - **A throw becomes a failed `JobResult`.** One job blowing up must not take the request down or,
 *   when several are run together, stop the others. The message is kept; the stack is not, because
 *   this result is returned over HTTP and a stack trace is a free map of the codebase (OWASP A05).
 * - **A hang becomes a failure after `timeoutMs`.** A job that waits forever on a provider would
 *   otherwise hold a cron request open until the platform kills it, with nothing recorded anywhere.
 * - **The duration is measured**, so "the stock alert job now takes 40 seconds" is visible before it
 *   becomes "the stock alert job times out".
 *
 * One honest limitation, stated rather than hidden: **a timeout abandons the job, it does not cancel
 * it.** JavaScript cannot interrupt a running promise. The handler keeps going and its writes still
 * land, so every job must be safe to have run twice — which is the idempotency each one already
 * needs for a cron that fires more often than a job takes to finish.
 */
import type { Job, JobContext, JobResult } from './types'

/** Two minutes. Longer than any job here needs, shorter than a platform's request ceiling. */
export const DEFAULT_JOB_TIMEOUT_MS = 120_000

export class JobTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`Job "${name}" did not finish within ${timeoutMs}ms`)
    this.name = 'JobTimeoutError'
  }
}

/** The message to report for a thrown value, without leaking a stack. */
function messageFor(error: unknown): string {
  if (error instanceof Error) return error.message

  return typeof error === 'string' && error.length > 0 ? error : 'Unknown error'
}

export interface RunJobOptions {
  timeoutMs?: number
  /** Injected so the duration is testable without a fake timer library. */
  clock?: () => number
}

export async function runJob(job: Job, context: JobContext, options: RunJobOptions = {}): Promise<JobResult> {
  const { timeoutMs = DEFAULT_JOB_TIMEOUT_MS, clock = () => Date.now() } = options
  const startedAt = clock()

  // Cleared on every path, so a job that finishes in a millisecond does not leave a two-minute timer
  // holding the process open — which is what turns a fast cron route into one that never responds.
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const counts = await Promise.race([
      job.run(context),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new JobTimeoutError(job.name, timeoutMs)), timeoutMs)
      }),
    ])

    return { job: job.name, ok: true, counts, durationMs: clock() - startedAt }
  } catch (error) {
    // Logged with the detail, returned without it.
    context.payload.logger.error({ err: error, job: job.name }, 'Scheduled job failed')

    return { job: job.name, ok: false, error: messageFor(error), durationMs: clock() - startedAt }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
