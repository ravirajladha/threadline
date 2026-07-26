'use client'

import { useCallback, useState } from 'react'
import { Button, useDocumentInfo } from '@payloadcms/ui'

/**
 * Stock adjustment, on the variant edit view.
 *
 * `stockQty` is read-only everywhere because it is derived from the ledger. This is how it is
 * meant to be changed: say what happened, and the server appends the movement that expresses
 * it. The owner never sees a signed quantity — they say "there are 12 on the shelf", or "40
 * arrived", or "2 were damaged", and the translation is `planStockCorrection` and friends.
 *
 * The reason is required, not optional politeness: a ledger whose rows do not say why they
 * exist is a list of numbers nobody can audit.
 */

type Mode = 'set' | 'receive' | 'writeOff'

const MODES: Array<{ value: Mode; label: string; quantityLabel: string }> = [
  { value: 'set', label: 'Stock count says', quantityLabel: 'Units on the shelf' },
  { value: 'receive', label: 'Delivery received', quantityLabel: 'Units received' },
  { value: 'writeOff', label: 'Damaged / written off', quantityLabel: 'Units written off' },
]

interface AdjustResponse {
  changed?: boolean
  stockQty?: number
  message?: string
  error?: string
}

export function StockAdjuster(): React.ReactElement {
  const { id: variantId } = useDocumentInfo()

  const [mode, setMode] = useState<Mode>('set')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async (): Promise<void> => {
    if (!variantId) {
      setStatus({ message: 'Save the variant before adjusting stock.', kind: 'error' })
      return
    }

    const parsed = Number(quantity)
    if (!Number.isInteger(parsed)) {
      setStatus({ message: 'Enter a whole number of units.', kind: 'error' })
      return
    }

    setBusy(true)
    try {
      const response = await fetch(`/api/variants/${variantId}/adjust-stock`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'set'
            ? { mode, targetQty: parsed, reason }
            : { mode, qty: parsed, reason },
        ),
      })

      const result = (await response.json()) as AdjustResponse

      if (!response.ok) {
        setStatus({ message: result.error ?? 'Could not adjust stock.', kind: 'error' })
        return
      }

      setStatus({
        message: result.changed
          ? `Stock is now ${result.stockQty}. Reload to see the movement.`
          : (result.message ?? 'Nothing changed.'),
        kind: 'ok',
      })
      setQuantity('')
      setReason('')
    } catch {
      setStatus({ message: 'The request failed. Check your connection and try again.', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }, [mode, quantity, reason, variantId])

  const active = MODES.find((option) => option.value === mode) ?? MODES[0]!

  return (
    <div className="threadline-action">
      <span className="threadline-action__title">Adjust stock</span>
      <p className="threadline-action__hint">
        Stock is the sum of this variant’s movements, so it is changed by recording what happened
        rather than by editing the number.
      </p>

      <div className="threadline-action__row">
        <label className="threadline-action__field">
          What happened
          <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
            {MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="threadline-action__field">
          {active.quantityLabel}
          <input
            type="number"
            min={0}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>

        <label className="threadline-action__field">
          Reason
          <input
            type="text"
            placeholder="Supplier delivery #4412"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        <Button disabled={busy || quantity === '' || reason.trim() === ''} onClick={() => void submit()}>
          Record
        </Button>
      </div>

      {status ? (
        <p className={`threadline-action__status threadline-action__status--${status.kind}`}>
          {status.message}
        </p>
      ) : null}
    </div>
  )
}

export default StockAdjuster
