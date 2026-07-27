import type { PricingView } from '@/lib/pricing/totals'
import { Price } from '../ui/Price'

/**
 * The totals block — rendered identically on the cart and inside the checkout order summary.
 *
 * This component performs **no arithmetic**. Every figure it shows is a field `priceCart`
 * already computed and `toPricingView` already flattened into paise, including the two halves
 * of the GST split. That is the whole point of `totals.ts` asserting its own invariant: the only
 * way a customer can be shown a total that does not reconcile is if something here invented a
 * number, so nothing here is allowed to.
 *
 * A minus sign in front of a discount is a **glyph**, not a negation — negating the paise would
 * be doing money maths at the render boundary, which is exactly the habit CLAUDE.md §2 forbids.
 */

export interface CartSummaryProps {
  pricing: PricingView
  heading?: string
  /** The CTA (or anything else) that sits under the totals. The cart passes a button; checkout does not. */
  footer?: React.ReactNode
  /** True while the cart is being re-read, so assistive tech is told the figures are moving. */
  pending?: boolean
}

function Row({
  label,
  children,
  emphasis = false,
}: {
  label: React.ReactNode
  children: React.ReactNode
  emphasis?: boolean
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={emphasis ? 'text-fg font-medium' : 'text-fg-muted text-sm'}>{label}</dt>
      <dd className={emphasis ? 'text-fg' : 'text-fg text-sm'}>{children}</dd>
    </div>
  )
}

/** A discount, drawn as a credit. The sign is typography; the amount is the server's. */
function Credit({ pricePaise }: { pricePaise: number }): React.ReactElement {
  return (
    <span className="text-success inline-flex items-baseline gap-1">
      <span aria-hidden="true">&minus;</span>
      <span className="sr-only">minus </span>
      <Price pricePaise={pricePaise} size="sm" />
    </span>
  )
}

export function CartSummary({
  pricing,
  heading = 'Order summary',
  footer,
  pending = false,
}: CartSummaryProps): React.ReactElement {
  const {
    subtotalPaise,
    shippingBasePaise,
    codFeePaise,
    isShippingFree,
    amountToFreeShippingPaise,
    taxTotalPaise,
    taxBreakup,
    jurisdiction,
    discountPaise,
    loyaltyDiscountPaise,
    grandTotalPaise,
    couponCode,
    loyaltyPointsUsed,
    pointsToEarn,
    itemCount,
  } = pricing

  return (
    <section
      aria-label={heading}
      aria-busy={pending}
      className={`bg-surface border-border rounded-[--radius-card] border p-4 transition-opacity duration-fast ease-out md:p-6 ${
        pending ? 'opacity-70' : ''
      }`}
    >
      <h2 className="text-fg text-base font-medium">{heading}</h2>

      <dl className="mt-4 flex flex-col gap-3" aria-live="polite">
        <Row label={itemCount === 1 ? 'Subtotal (1 item)' : `Subtotal (${itemCount} items)`}>
          <Price pricePaise={subtotalPaise} size="sm" />
        </Row>

        {discountPaise > 0 ? (
          <Row label={couponCode ? `Discount (${couponCode})` : 'Discount'}>
            <Credit pricePaise={discountPaise} />
          </Row>
        ) : null}

        {loyaltyDiscountPaise > 0 ? (
          <Row
            label={
              loyaltyPointsUsed === 1 ? 'Points redeemed (1 point)' : `Points redeemed (${loyaltyPointsUsed} points)`
            }
          >
            <Credit pricePaise={loyaltyDiscountPaise} />
          </Row>
        ) : null}

        <Row label="Delivery">
          {isShippingFree ? (
            <span className="text-success text-sm font-medium">Free</span>
          ) : (
            <Price pricePaise={shippingBasePaise} size="sm" />
          )}
        </Row>

        {/* Only ever shown when the customer actually chose cash on delivery. */}
        {codFeePaise > 0 ? (
          <Row label="Cash on delivery fee">
            <Price pricePaise={codFeePaise} size="sm" />
          </Row>
        ) : null}

        {/*
          The two jurisdictions are mutually exclusive by construction — `splitTax` puts the whole
          amount in one side or the other — so showing both would always be showing a zero.
        */}
        {taxTotalPaise > 0 ? (
          jurisdiction === 'intra_state' ? (
            <>
              <Row label="CGST">
                <Price pricePaise={taxBreakup.cgstPaise} size="sm" />
              </Row>
              <Row label="SGST">
                <Price pricePaise={taxBreakup.sgstPaise} size="sm" />
              </Row>
            </>
          ) : (
            <Row label="IGST">
              <Price pricePaise={taxBreakup.igstPaise} size="sm" />
            </Row>
          )
        ) : null}

        <div className="border-border mt-1 border-t pt-3">
          <Row label="Total" emphasis>
            <Price pricePaise={grandTotalPaise} size="lg" />
          </Row>
        </div>
      </dl>

      {amountToFreeShippingPaise !== null ? (
        <p className="text-fg-muted mt-4 inline-flex flex-wrap items-baseline gap-1 text-sm">
          <span>Add</span>
          <Price pricePaise={amountToFreeShippingPaise} size="sm" />
          <span>more for free delivery.</span>
        </p>
      ) : null}

      {pointsToEarn > 0 ? (
        <p className="text-fg-subtle mt-2 text-sm">
          You will earn {pointsToEarn === 1 ? '1 point' : `${pointsToEarn} points`} once this order
          is delivered.
        </p>
      ) : null}

      {footer ? <div className="mt-6">{footer}</div> : null}
    </section>
  )
}
