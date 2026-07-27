'use client'
// Interactive: stands in for a payment provider's widget while the gateway is stubbed.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Price } from '../ui/Price'

/**
 * The local payment screen.
 *
 * This is the only component in the storefront that exists *because* something is stubbed, and it
 * is deliberately styled to look like scaffolding rather than a finished surface — a payment page
 * that looks real is one somebody eventually mistakes for real.
 *
 * It offers the failure outcome as prominently as the success one. That is the point: the
 * happy path is the part a stub trivially fakes, whereas releasing the stock reservation and
 * moving the order to a failed state is our own code, and it is untestable by hand otherwise.
 *
 * It never says whether payment succeeded. It asks the server to run the webhook and follows
 * wherever it is sent — the browser's opinion about payment is not part of the flow (OWASP A04).
 */

const GENERIC_ERROR = 'We could not reach the payment simulator. Please try again.'

export interface StubPaymentPanelProps {
  orderNumber: string
  amountPaise: number
}

export function StubPaymentPanel({
  orderNumber,
  amountPaise,
}: StubPaymentPanelProps): React.ReactElement {
  const router = useRouter()
  const [pending, setPending] = useState<'pay' | 'fail' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const simulate = async (outcome: 'pay' | 'fail'): Promise<void> => {
    setPending(outcome)
    setError(null)

    let response: Response
    try {
      response = await fetch('/api/payments/simulate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: outcome === 'fail' ? 'fail' : 'pay' }),
      })
    } catch {
      setError(GENERIC_ERROR)
      setPending(null)
      return
    }

    const body: unknown = await response.json().catch(() => null)
    const payload = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}

    if (response.ok && typeof payload.redirectUrl === 'string') {
      // `replace`, not `push`: the pay screen must not sit in the history for the back button to
      // land on once the order has already been settled.
      router.replace(payload.redirectUrl)
      return
    }

    setError(typeof payload.error === 'string' ? payload.error : GENERIC_ERROR)
    setPending(null)
  }

  return (
    <div className="border-border mx-auto max-w-md rounded-card border p-6">
      <p className="text-warning border-warning/40 bg-warning/10 mb-6 rounded-control border px-3 py-2 text-xs font-medium">
        Development payment simulator — no money moves.
      </p>

      <dl className="mb-6 flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between">
          <dt className="text-fg-muted">Order</dt>
          <dd className="text-fg font-medium">{orderNumber}</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-fg-muted">Amount due</dt>
          <dd>
            <Price pricePaise={amountPaise} size="lg" />
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => {
            void simulate('pay')
          }}
          className="bg-accent text-accent-fg hover:bg-accent-hover rounded-control px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending === 'pay' ? 'Processing…' : 'Simulate successful payment'}
        </button>

        <button
          type="button"
          disabled={pending !== null}
          onClick={() => {
            void simulate('fail')
          }}
          className="border-border-strong text-fg-muted hover:text-fg rounded-control border px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending === 'fail' ? 'Processing…' : 'Simulate failed payment'}
        </button>
      </div>

      <div aria-live="assertive" className="mt-4 min-h-5">
        {error !== null ? <p className="text-danger text-sm font-medium">{error}</p> : null}
      </div>
    </div>
  )
}
