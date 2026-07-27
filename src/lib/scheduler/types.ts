/**
 * The job contract.
 *
 * Four recurring jobs exist by the end of J5 and more will follow, so they are described by one
 * interface rather than written as four route handlers that happen to look similar. What that buys:
 * the cron route can be *one* route, the registry can refuse a duplicate name at module load, and a
 * job can be run in a test without a request.
 *
 * **A job reports counts, not prose.** `{ examined: 120, notified: 3, skipped: 117 }` makes a cron
 * run auditable from the response alone — the owner can see the abandoned-cart job looked at 120
 * carts and mailed 3, without reading a log. A job that returns only "ok" is a job nobody notices
 * has silently stopped doing anything, which is the characteristic failure of scheduled work.
 */
import type { Payload } from 'payload'

/** Every job's name. A union, so a typo is a compile error and a URL cannot name arbitrary code. */
export const JOB_NAMES = ['abandoned-cart', 'status-sync', 'stock-alerts', 'review-requests'] as const
export type JobName = (typeof JOB_NAMES)[number]

export function isJobName(value: unknown): value is JobName {
  return typeof value === 'string' && (JOB_NAMES as readonly string[]).includes(value)
}

/** What a job did, in counts. Keys are the job's own; the runner never interprets them. */
export type JobCounts = Readonly<Record<string, number>>

/**
 * What a job is given.
 *
 * `now` is injected rather than read from `Date.now()` inside a handler, for the same reason the
 * rate limiter takes a clock: "carts idle for six hours" is only testable if the test can say what
 * time it is.
 */
export interface JobContext {
  payload: Payload
  now: Date
}

export interface Job {
  readonly name: JobName
  /** Shown in the admin and in the cron route's own error messages. One line. */
  readonly description: string
  run(context: JobContext): Promise<JobCounts>
}

/** The outcome of one run. Always returned — a failure is a result, not a throw. */
export type JobResult =
  | { job: JobName; ok: true; counts: JobCounts; durationMs: number }
  /** `error` is a message for staff. Never a stack trace, which the route would return to a caller. */
  | { job: JobName; ok: false; error: string; durationMs: number }
