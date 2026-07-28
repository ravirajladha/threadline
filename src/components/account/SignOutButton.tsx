'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Sign out.
 *
 * A button rather than a link, because signing out is a mutation: a `GET` that ends a session can
 * be triggered by any image tag on any page, which is the textbook logout CSRF. The refresh
 * afterwards is a full server round trip, since every account page decides what to render from the
 * cookie the server just cleared.
 */
export function SignOutButton(): React.ReactElement {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut(): Promise<void> {
    setBusy(true)

    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      })

      router.refresh()
      router.push('/')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void signOut()}
      className="text-fg-muted hover:text-fg text-sm underline underline-offset-4 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
