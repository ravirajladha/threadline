'use client'
// Interactive: payment method, the points box, and the button that commits the order.

import { useId } from 'react'
import { loyaltyRejectionMessage, type LoyaltyRejection, type LoyaltyRules } from '@/lib/pricing/loyalty'
import { PAYMENT_METHODS, type PaymentMethod } from '@/types'
import { Price } from '../ui/Price'

/**
 * The last section of the checkout: how to pay, whether to spend points, and the commit.
 *
 * The points box offers a **ceiling the server calculated** (`loyaltyPointsAvailable`, the lowest
 * of the balance, the owner's percentage cap and what is left to pay) rather than working one out
 * from the balance and the total. Two ceilings computed in two places is how a customer ends up
 * being offered a redemption the order endpoint then refuses.
 *
 * Nothing here decides what will be charged. The button shows the server's grand total and the
 * server prices the order again when it receives it.
 */

const METHOD_LABELS: Record<PaymentMethod, string> = {
  razorpay: 'Pay online',
  cod: 'Cash on delivery',
}

export interface PaymentStepProps {
  method: PaymentMethod
  onMethodChange: (method: PaymentMethod) => void
  /** From `settings`. When the owner has COD off, the option is absent, not disabled. */
  codEnabled: boolean
  /** Shown against the COD option so the fee is disclosed before it is chosen. */
  codFeePaise: number

  loyaltyRules: LoyaltyRules
  loyaltyBalance: number
  /** The most that may be spent on this cart — the server's number. */
  loyaltyPointsAvailable: number
  /** What the customer has asked to spend. */
  loyaltyPointsRequested: number
  /** What the last pricing run actually applied. Differs from `requested` until totals refresh. */
  loyaltyPointsUsed: number
  loyaltyRejection: LoyaltyRejection | null
  onLoyaltyPointsChange: (points: number) => void

  grandTotalPaise: number
  /** False while the cart still has a blocking issue or the form is incomplete. */
  canPlaceOrder: boolean
  pending?: boolean
  error?: string | null
  onPlaceOrder: () => void
}

export function PaymentStep({
  method,
  onMethodChange,
  codEnabled,
  codFeePaise,
  loyaltyRules,
  loyaltyBalance,
  loyaltyPointsAvailable,
  loyaltyPointsRequested,
  loyaltyPointsUsed,
  loyaltyRejection,
  onLoyaltyPointsChange,
  grandTotalPaise,
  canPlaceOrder,
  pending = false,
  error = null,
  onPlaceOrder,
}: PaymentStepProps): React.ReactElement {
  const methodGroup = useId()
  const pointsId = useId()

  const methods = PAYMENT_METHODS.filter((candidate) => candidate !== 'cod' || codEnabled)
  const showPoints = loyaltyRules.enabled && loyaltyBalance > 0

  return (
    <div className="flex flex-col gap-8">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <legend className="text-fg mb-2 text-base font-medium">Payment</legend>

        {methods.map((candidate) => (
          <label
            key={candidate}
            className={`flex cursor-pointer items-start gap-3 rounded-control border p-4 transition-colors duration-fast ease-out ${
              candidate === method ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-surface-raised'
            }`}
          >
            <input
              type="radio"
              name={methodGroup}
              value={candidate}
              checked={candidate === method}
              onChange={() => onMethodChange(candidate)}
              className="accent-accent mt-0.5 size-4"
            />
            <span className="flex flex-col gap-1">
              <span className="text-fg text-sm font-medium">{METHOD_LABELS[candidate]}</span>
              {candidate === 'razorpay' ? (
                <span className="text-fg-muted text-sm">UPI, cards, netbanking and wallets.</span>
              ) : (
                <span className="text-fg-muted inline-flex flex-wrap items-baseline gap-1 text-sm">
                  <span>Pay the courier when it arrives.</span>
                  {codFeePaise > 0 ? (
                    <>
                      <Price pricePaise={codFeePaise} size="sm" />
                      <span>handling fee applies.</span>
                    </>
                  ) : null}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {showPoints ? (
        <div className="border-border flex flex-col gap-2 rounded-control border p-4">
          <label htmlFor={pointsId} className="text-fg text-sm font-medium">
            Use loyalty points
          </label>
          <p className="text-fg-muted text-sm">
            You have {loyaltyBalance === 1 ? '1 point' : `${loyaltyBalance} points`}.{' '}
            {loyaltyPointsAvailable > 0
              ? `Up to ${loyaltyPointsAvailable} can be used on this order.`
              : `Points cannot be used on this order — the minimum is ${loyaltyRules.minRedeem}.`}
          </p>

          <div className="flex gap-2">
            <input
              id={pointsId}
              type="number"
              min={0}
              max={loyaltyPointsAvailable}
              step={1}
              inputMode="numeric"
              value={loyaltyPointsRequested === 0 ? '' : String(loyaltyPointsRequested)}
              placeholder="0"
              disabled={pending || loyaltyPointsAvailable === 0}
              onChange={(event) => {
                // Whole points only, and never above the server's own ceiling. Clamping is not
                // validation — the endpoint clamps again, and `redeemPoints` clamps after that.
                const parsed = Number(event.target.value)
                const points = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
                onLoyaltyPointsChange(Math.min(points, loyaltyPointsAvailable))
              }}
              aria-invalid={loyaltyRejection !== null}
              aria-describedby={loyaltyRejection !== null ? `${pointsId}-error` : undefined}
              className="border-border bg-surface text-fg w-32 rounded-control border px-3 py-2 text-sm disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => onLoyaltyPointsChange(loyaltyPointsAvailable)}
              disabled={pending || loyaltyPointsAvailable === 0 || loyaltyPointsRequested === loyaltyPointsAvailable}
              className="border-border-strong text-fg hover:bg-surface-raised rounded-control border px-4 py-2 text-sm transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50"
            >
              Use all
            </button>
          </div>

          <div aria-live="polite">
            {loyaltyRejection !== null ? (
              <p id={`${pointsId}-error`} className="text-danger text-sm">
                {loyaltyRejectionMessage(loyaltyRejection, loyaltyRules)}
              </p>
            ) : loyaltyPointsUsed > 0 ? (
              <p className="text-success text-sm">
                {loyaltyPointsUsed === 1 ? '1 point' : `${loyaltyPointsUsed} points`} applied to this
                order.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {/* The amount sits beside the button rather than inside it: `Price` sets its own
            foreground colour, which on an accent-filled button would be the wrong one. */}
        <p className="text-fg-muted inline-flex flex-wrap items-baseline gap-1.5 text-sm">
          <span>You will pay</span>
          <Price pricePaise={grandTotalPaise} />
        </p>

        <button
          type="button"
          onClick={onPlaceOrder}
          disabled={!canPlaceOrder || pending}
          className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center justify-center gap-2 rounded-control px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Placing your order…' : 'Place order'}
        </button>

        <div aria-live="assertive">
          {error !== null ? <p className="text-danger text-sm font-medium">{error}</p> : null}
        </div>
      </div>
    </div>
  )
}
