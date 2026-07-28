/**
 * The *shape* of a one-time code, with no dependency on how one is sent or checked.
 *
 * This exists because `otp.ts` reaches `node:crypto` — `StubOtpChannel` compares in constant time
 * through `payments/signature`, which is the right thing for it to do — and the sign-in form needs
 * nothing from that. It only needs to know a code is six digits, so its input can be the right
 * width and reject a wrong-length entry before a request is made.
 *
 * A `'use client'` component importing `OTP_LENGTH` from `otp.ts` pulls the whole channel, and the
 * channel pulls `node:crypto`, and webpack cannot bundle a Node built-in for the browser. That is
 * not a warning — it fails the production build outright, while `next dev` compiles per route and
 * never notices. The rule this file exists to keep: **a module a client component imports must not
 * transitively import `node:*`.** Same shape as the `settings/mappers.ts` split in J8, and the same
 * reason — the pure part had been taken hostage by a heavyweight neighbour.
 *
 * `otp.ts` re-exports everything here, so nothing else moved.
 */

/** How long a code a person has to type should be. Six digits is the convention customers expect. */
export const OTP_LENGTH = 6

/** The fixed development code, per CLAUDE.md §2. Never reachable in production — see `factory.ts`. */
export const STUB_OTP_CODE = '000000'

/**
 * Narrow untrusted input to something that could be a code.
 *
 * Checked before any comparison so a caller cannot submit a 10,000-character string and make the
 * comparison itself the denial of service.
 */
export function isPlausibleOtp(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9]{${OTP_LENGTH}}$`).test(value)
}
