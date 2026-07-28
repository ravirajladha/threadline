'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// `otpCode`, not `otp` — the latter reaches `node:crypto` through the stub channel's constant-time
// comparison, which webpack cannot bundle for the browser. See the note in `lib/auth/otpCode.ts`.
import { OTP_LENGTH } from '@/lib/auth/otpCode'

/**
 * Sign in with a one-time code.
 *
 * Two steps, one component, because the second step is meaningless without the first and splitting
 * them across routes would put the address in a URL.
 *
 * **The form never says whether an account exists.** The server's answer to a code request is the
 * same either way, and this renders that answer verbatim rather than interpreting it — a friendly
 * "we don't have that address, would you like to register?" here would undo the whole enumeration
 * defence the API is built around (OWASP A07).
 *
 * The code input is `inputMode="numeric"` with `autoComplete="one-time-code"`, which is what lets a
 * phone offer the code from its own notification. Small, and the difference between a login people
 * complete and one they abandon.
 */

type Step = 'address' | 'code'

export function SignInForm(): React.ReactElement {
  const router = useRouter()

  const [step, setStep] = useState<Step>('address')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    return { ok: response.ok, data: (await response.json()) as Record<string, unknown> }
  }

  async function requestCode(): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      const { ok, data } = await post({ action: 'request', email })

      if (!ok) {
        setError(typeof data.error === 'string' ? data.error : 'That did not work.')
        return
      }

      // Straight from the server, unedited — see the note above.
      setNotice(typeof data.message === 'string' ? data.message : 'Check your email for a code.')
      setStep('code')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verify(): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      const { ok, data } = await post({ action: 'verify', email, code })

      if (!ok) {
        setError(typeof data.error === 'string' ? data.error : 'That code is not right.')
        return
      }

      // A full refresh, not a client-side push: the session cookie has only just been set, and
      // every account page renders on the server from it.
      router.refresh()
      router.push('/account')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void (step === 'address' ? requestCode() : verify())
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-fg text-sm font-medium">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          // Going back to change the address must invalidate the step, or a code sent to one
          // address is submitted against another.
          onChange={(event) => {
            setEmail(event.target.value)
            setStep('address')
            setNotice(null)
          }}
          className="border-border bg-surface text-fg rounded-control border px-3 py-2 text-sm"
          placeholder="you@example.com"
        />
      </label>

      {step === 'code' ? (
        <label className="flex flex-col gap-1">
          <span className="text-fg text-sm font-medium">Six-digit code</span>
          <input
            type="text"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            pattern={`[0-9]{${OTP_LENGTH}}`}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            className="border-border bg-surface text-fg rounded-control border px-3 py-2 text-center text-lg tracking-[0.4em]"
            placeholder="000000"
          />
        </label>
      ) : null}

      {notice ? <p className="text-fg-muted text-sm">{notice}</p> : null}
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || (step === 'code' ? code.length !== OTP_LENGTH : email.trim() === '')}
        className="bg-accent text-accent-fg hover:bg-accent-hover rounded-control px-4 py-2.5 text-sm font-medium transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Just a moment…' : step === 'address' ? 'Email me a code' : 'Sign in'}
      </button>

      {step === 'code' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void requestCode()}
          className="text-fg-muted hover:text-fg text-sm underline underline-offset-4"
        >
          Send another code
        </button>
      ) : null}
    </form>
  )
}
