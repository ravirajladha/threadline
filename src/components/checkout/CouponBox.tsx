'use client'
// Interactive: holds the half-typed code and submits it. The verdict comes from the server.

import { useId, useState } from 'react'
import { couponRejectionMessage, type CouponRejection } from '@/lib/pricing/coupon'

/**
 * Apply or remove a discount code.
 *
 * This component never decides whether a code is valid — `evaluateCoupon` does, on the server,
 * and hands back a typed `CouponRejection`. Turning that into a sentence goes through
 * `couponRejectionMessage` rather than a switch written here, so the wording of "that code has
 * expired" lives in one place and a new rejection reason cannot be added without the compiler
 * pointing at the copy that has to cover it.
 */

export interface CouponBoxProps {
  /** Set when a code is currently applied. Mutually exclusive with `rejection`. */
  couponCode: string | null
  rejection: CouponRejection | null
  /** True while an apply or remove is in flight. */
  pending?: boolean
  onApply: (code: string) => void
  onRemove: () => void
}

export function CouponBox({
  couponCode,
  rejection,
  pending = false,
  onApply,
  onRemove,
}: CouponBoxProps): React.ReactElement {
  const [code, setCode] = useState('')
  const inputId = useId()

  if (couponCode !== null) {
    return (
      <div className="border-border bg-surface-raised flex items-center justify-between gap-4 rounded-[--radius-control] border p-3">
        <p className="text-fg text-sm">
          <span className="font-medium">{couponCode}</span>
          <span className="text-fg-muted"> applied</span>
        </p>
        <button
          type="button"
          onClick={onRemove}
          disabled={pending}
          className="text-accent text-sm underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = code.trim()
        if (trimmed.length > 0) onApply(trimmed)
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor={inputId} className="text-fg text-sm font-medium">
        Discount code
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          value={code}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Enter code"
          onChange={(event) => setCode(event.target.value)}
          disabled={pending}
          aria-invalid={rejection !== null}
          aria-describedby={rejection !== null ? `${inputId}-error` : undefined}
          className="border-border bg-surface text-fg placeholder:text-fg-subtle min-w-0 flex-1 rounded-[--radius-control] border px-3 py-2 text-sm uppercase disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || code.trim().length === 0}
          className="border-border-strong text-fg hover:bg-surface-raised shrink-0 rounded-[--radius-control] border px-4 py-2 text-sm font-medium transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Checking…' : 'Apply'}
        </button>
      </div>

      <div aria-live="polite">
        {rejection !== null ? (
          <p id={`${inputId}-error`} className="text-danger text-sm">
            {couponRejectionMessage(rejection)}
          </p>
        ) : null}
      </div>
    </form>
  )
}
