'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Choose what to send back.
 *
 * The form **only offers what the server said is returnable** — the eligible lines and their
 * maximum quantities are computed by `evaluateReturnEligibility` on the server and passed in. That
 * is not a security control (the API re-derives all of it, because a form can be edited), it is a
 * usability one: a customer should not be able to *ask* for something that will be refused, and the
 * two decisions come from the same function, so the form and the answer cannot disagree.
 *
 * Refused lines are shown struck through with their reason rather than hidden, the same choice as
 * a sold-out size in J3: "why can't I return this?" is a support ticket, and the reason costs a line.
 */

export interface ReturnableLineView {
  orderItemId: number
  productTitle: string
  sizeLabel: string
  colourName: string
  maxQty: number
  /** Null when the line is returnable. */
  refusalMessage: string | null
}

export interface ReturnFormProps {
  orderNumber: string
  lines: ReturnableLineView[]
}

const REASONS = [
  { value: 'too_small', label: 'Too small' },
  { value: 'too_large', label: 'Too large' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'damaged', label: 'Damaged or defective' },
  { value: 'wrong_item', label: 'Wrong item sent' },
  { value: 'changed_mind', label: 'Changed my mind' },
] as const

export function ReturnForm({ orderNumber, lines }: ReturnFormProps): React.ReactElement {
  const router = useRouter()

  const [selected, setSelected] = useState<Record<number, { qty: number; reason: string }>>({})
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const chosen = Object.entries(selected)

  function toggle(line: ReturnableLineView, on: boolean): void {
    setSelected((current) => {
      const next = { ...current }

      if (on) next[line.orderItemId] = { qty: 1, reason: 'too_small' }
      else delete next[line.orderItemId]

      return next
    })
  }

  function update(orderItemId: number, patch: Partial<{ qty: number; reason: string }>): void {
    setSelected((current) => {
      const existing = current[orderItemId]
      if (existing === undefined) return current

      return { ...current, [orderItemId]: { ...existing, ...patch } }
    })
  }

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'raise',
          orderNumber,
          type: 'return',
          customerNote: note,
          lines: chosen.map(([orderItemId, entry]) => ({
            orderItemId: Number(orderItemId),
            qty: entry.qty,
            reason: entry.reason,
          })),
        }),
      })

      const result = (await response.json()) as { error?: string }

      if (!response.ok) {
        setError(result.error ?? 'That did not work.')
        return
      }

      setDone(true)
      // The order page re-renders from the server, which is where the new return will appear.
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="text-fg-muted text-sm">
        Thanks — we have your request and will email you once it is approved.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="border-border divide-border divide-y border-y">
        {lines.map((line) => {
          const entry = selected[line.orderItemId]
          const returnable = line.refusalMessage === null

          return (
            <li key={line.orderItemId} className="flex flex-col gap-2 py-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  disabled={!returnable}
                  checked={entry !== undefined}
                  onChange={(event) => toggle(line, event.target.checked)}
                  className="mt-1"
                />
                <span className="flex flex-col gap-0.5">
                  <span className={`text-sm font-medium ${returnable ? 'text-fg' : 'text-fg-subtle line-through'}`}>
                    {line.productTitle}
                  </span>
                  <span className="text-fg-muted text-sm">
                    {line.colourName} · {line.sizeLabel}
                  </span>
                  {line.refusalMessage ? (
                    <span className="text-fg-subtle text-xs">{line.refusalMessage}</span>
                  ) : null}
                </span>
              </label>

              {entry !== undefined ? (
                <div className="flex flex-wrap gap-3 pl-7">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-fg-muted">How many</span>
                    <input
                      type="number"
                      min={1}
                      max={line.maxQty}
                      value={entry.qty}
                      onChange={(event) =>
                        update(line.orderItemId, {
                          // Clamped here as well as on the server — not as a control, but so the
                          // field cannot show a number the request will refuse.
                          qty: Math.min(line.maxQty, Math.max(1, Number(event.target.value) || 1)),
                        })
                      }
                      className="border-border bg-surface text-fg w-16 rounded-control border px-2 py-1"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-fg-muted">Why</span>
                    <select
                      value={entry.reason}
                      onChange={(event) => update(line.orderItemId, { reason: event.target.value })}
                      className="border-border bg-surface text-fg rounded-control border px-2 py-1"
                    >
                      {REASONS.map((reason) => (
                        <option key={reason.value} value={reason.value}>
                          {reason.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      <label className="flex flex-col gap-1">
        <span className="text-fg text-sm font-medium">Anything else we should know?</span>
        <textarea
          rows={3}
          maxLength={2_000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="border-border bg-surface text-fg rounded-control border px-3 py-2 text-sm"
          placeholder="Optional"
        />
      </label>

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          disabled={busy || chosen.length === 0}
          onClick={() => void submit()}
          className="bg-accent text-accent-fg hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Request a return'}
        </button>
      </div>
    </div>
  )
}
