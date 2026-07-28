/**
 * `/account` — the shell.
 *
 * Signed out, it is the sign-in form. Signed in, it is a short set of doors: orders, requests,
 * wishlist. Nothing personal is rendered beyond the customer's own name and points balance, both
 * read server-side from the session — there is no id in a URL and no customer data in a prop that a
 * client component could be persuaded to fetch with.
 *
 * The page is `force-dynamic` and marked `noindex`: it is different for every visitor, and a cached
 * copy of one customer's account served to another is the worst bug this file could have.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { getPayload } from 'payload'

import config from '@payload-config'
import { SignInForm } from '@/components/account/SignInForm'
import { SignOutButton } from '@/components/account/SignOutButton'
import { readCustomerSession } from '@/lib/auth/customerSession'
import { numericId } from '@/lib/utils/ids'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
}

/**
 * The doors, and whether each one is built yet.
 *
 * `ready: false` renders as plain text rather than a link. A door that 404s is worse than a door
 * that says "soon" — the first reads as a broken account, the second as a shop still being built.
 * Flip the flag as each route lands; that is the whole of the change.
 */
const DOORS = [
  { href: '/account/orders', label: 'Orders', hint: 'What you have bought, and where it is', ready: false },
  { href: '/account/requests', label: 'Requests', hint: 'Support threads and their replies', ready: true },
  { href: '/account/wishlist', label: 'Wishlist', hint: 'Saved pieces and back-in-stock alerts', ready: false },
]

export default async function AccountPage() {
  const payload = await getPayload({ config })
  const session = await readCustomerSession(await headers(), payload)

  if (session === null) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 px-4 py-16 sm:px-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-fg text-2xl font-medium">Sign in</h1>
          <p className="text-fg-muted text-sm">
            We&rsquo;ll email you a six-digit code. No password to remember.
          </p>
        </div>
        <SignInForm />
      </div>
    )
  }

  // Read by id from the session, never from anything the request supplied.
  const customer = await payload.findByID({
    collection: 'customers',
    id: numericId(session.id),
    depth: 0,
    overrideAccess: true,
  })

  const points = typeof customer.loyaltyPoints === 'number' ? customer.loyaltyPoints : 0
  const firstName = (typeof customer.name === 'string' ? customer.name : '').trim().split(/\s+/)[0]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-fg text-2xl font-medium">
            {firstName ? `Hello, ${firstName}` : 'Your account'}
          </h1>
          <p className="text-fg-muted text-sm">
            {points > 0
              ? `${points.toLocaleString('en-IN')} point${points === 1 ? '' : 's'} to spend at checkout`
              : 'Points appear here once an order is delivered'}
          </p>
        </div>
        <SignOutButton />
      </div>

      <ul className="flex flex-col gap-3">
        {DOORS.map((door) =>
          door.ready ? (
            <li key={door.href}>
              <Link
                href={door.href}
                className="border-border hover:bg-surface-raised flex flex-col gap-0.5 rounded-card border p-4 transition-colors duration-fast ease-out"
              >
                <span className="text-fg font-medium">{door.label}</span>
                <span className="text-fg-muted text-sm">{door.hint}</span>
              </Link>
            </li>
          ) : (
            <li
              key={door.href}
              className="border-border flex flex-col gap-0.5 rounded-card border border-dashed p-4 opacity-60"
            >
              <span className="text-fg font-medium">
                {door.label} <span className="text-fg-subtle text-xs font-normal">· coming soon</span>
              </span>
              <span className="text-fg-muted text-sm">{door.hint}</span>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
