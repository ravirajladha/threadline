'use client'

import { useCallback, useState } from 'react'
import { Button, useDocumentInfo, useFormFields } from '@payloadcms/ui'

import {
  describeRefusal,
  fulfilmentOptions,
  type FulfilmentAction,
  type FulfilmentState,
} from '@/lib/orders/fulfilment'

/**
 * Fulfilment, on the order edit view.
 *
 * The component decides nothing. It reads the order's current fields, hands them to
 * `fulfilmentOptions` and renders the answer — which is the same function the endpoint's port asks,
 * so a button being enabled here and the server refusing it there cannot disagree (CLAUDE.md §2 —
 * components render, `lib/` decides).
 *
 * **A refused action is shown disabled with its reason, not hidden.** The same argument as a
 * sold-out size in J3: staff need to know that "Ship" exists and why it is not available yet, and
 * "book a courier first" is an instruction where a missing button is a mystery.
 *
 * The server remains the authority regardless. This view may be minutes stale — a courier's webhook
 * could have moved the order since it rendered — so the endpoint re-reads the state under a row
 * lock and decides again. What is rendered here is a prediction; what happens is decided there.
 */

const ACTION_LABELS: Readonly<Record<FulfilmentAction, string>> = {
  pack: 'Mark packed',
  ship: 'Mark shipped',
  deliver: 'Mark delivered',
}

interface ActionResponse {
  ok?: boolean
  status?: string
  awbCode?: string
  courier?: string
  alreadyBooked?: boolean
  error?: string
}

/** Read one field's value out of the form state, as a string. */
function useFieldValue(path: string): string | null {
  return useFormFields(([fields]) => {
    const value = fields?.[path]?.value

    return typeof value === 'string' && value.length > 0 ? value : null
  })
}

export function FulfilmentActions(): React.ReactElement {
  const { id: orderId } = useDocumentInfo()

  const status = useFieldValue('status')
  const paymentStatus = useFieldValue('paymentStatus')
  const paymentMethod = useFieldValue('paymentMethod')
  // `awbCode` sits inside a `collapsible`, which is presentational — the field path stays flat.
  const awbCode = useFieldValue('awbCode')

  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  const post = useCallback(
    async (path: string, body?: Record<string, unknown>): Promise<void> => {
      if (!orderId) {
        setMessage({ text: 'Save the order before fulfilling it.', kind: 'error' })
        return
      }

      setBusy(true)
      try {
        const response = await fetch(`/api/orders/${orderId}/${path}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })

        const result = (await response.json()) as ActionResponse

        if (!response.ok) {
          setMessage({ text: result.error ?? 'That did not work.', kind: 'error' })
          return
        }

        setMessage({
          text:
            result.awbCode === undefined
              ? `Order is now ${result.status?.replace(/_/g, ' ')}. Reload to see the event.`
              : result.alreadyBooked
                ? `Already booked with ${result.courier} — AWB ${result.awbCode}.`
                : `Booked with ${result.courier} — AWB ${result.awbCode}. Reload to see it.`,
          kind: 'ok',
        })
      } catch {
        setMessage({ text: 'The request failed. Check your connection and try again.', kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [orderId],
  )

  // Until the document has loaded there is nothing to decide from, and guessing a status would
  // render buttons that contradict themselves a moment later.
  if (status === null || paymentStatus === null || paymentMethod === null) {
    return <div className="threadline-action">Loading fulfilment actions…</div>
  }

  const state = {
    status,
    paymentStatus,
    paymentMethod,
    awbCode,
  } as FulfilmentState

  const options = fulfilmentOptions(state)
  const canBook = awbCode === null

  return (
    <div className="threadline-action">
      <span className="threadline-action__title">Fulfilment</span>
      <p className="threadline-action__hint">
        {awbCode === null
          ? 'Book a courier to get a tracking number, then move the order along as it is packed and handed over.'
          : `Tracking number ${awbCode}. Tracking events from the courier move this order on their own.`}
      </p>

      <div className="threadline-action__row">
        <Button disabled={busy || !canBook} onClick={() => void post('book-shipment')}>
          Book courier
        </Button>

        {options.map((option) => (
          // The reason rides on a wrapper rather than the button, because a disabled control does
          // not reliably fire the hover that shows a tooltip.
          <span key={option.action} title={option.allowed ? undefined : describeRefusal(option)}>
            <Button
              disabled={busy || !option.allowed}
              onClick={() => void post('fulfil', { action: option.action })}
            >
              {ACTION_LABELS[option.action]}
            </Button>
          </span>
        ))}
      </div>

      {message ? (
        <p className={`threadline-action__status threadline-action__status--${message.kind}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  )
}

export default FulfilmentActions
