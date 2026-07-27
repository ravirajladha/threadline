'use client'
// Interactive: the whole single-page checkout — address, delivery, payment — in one client tree.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { postCartAction } from '@/lib/cart/client'
import type { CartView as Cart } from '@/lib/cart/types'
import { normaliseEmail, validateAddress, type AddressSnapshot } from '@/lib/orders/address'
import type { LoyaltyRules } from '@/lib/pricing/loyalty'
import type { PaymentMethod } from '@/types'
import { EmptyState } from '../ui/EmptyState'
import { BagIcon } from '../ui/icons'
import { AddressForm } from './AddressForm'
import { CouponBox } from './CouponBox'
import { OrderSummary } from './OrderSummary'
import { PaymentStep } from './PaymentStep'

/**
 * The checkout page body.
 *
 * DESIGN.md asks for one sectioned page rather than a wizard, so all of it is one client tree
 * with a single owner for the address, the payment method and the points request. Everything it
 * *displays* about money came from the server; everything it *collects* is sent back for the
 * server to price again.
 *
 * Validation is run here through `validateAddress` — the same function the endpoint uses — so a
 * customer sees every bad field at once instead of one per submit. It is a convenience and
 * nothing more: the request body is validated again on arrival, because a form is not a boundary.
 *
 * One honest limitation, and it is a deliberate one. The destination state and the payment method
 * change the GST split and the carriage, but `/api/cart` has no re-price action, so the totals on
 * this page are the ones the cart was last priced with. Rather than compute the difference in the
 * browser — which would put a second, untested pricing implementation in front of the customer —
 * the page says so, and the order is priced authoritatively when it is placed.
 */

const EMPTY_ADDRESS: AddressSnapshot = {
  name: '',
  phone: '',
  line1: '',
  line2: null,
  city: '',
  state: '',
  pincode: '',
  country: 'India',
}

/** What `/api/checkout` reports when stock moved between the cart being read and the order landing. */
interface CheckoutShortage {
  variantId: number | string
  requested: number
  available: number
}

const GENERIC_ERROR = 'We could not place your order. Please try again.'

export interface CheckoutViewProps {
  /** The server-priced cart. Seeds the first render; a coupon change replaces it. */
  cart: Cart
  /** From `settings`, so the points box offers what the owner actually configured. */
  loyaltyRules: LoyaltyRules
  /** The signed-in customer's balance. Zero for a guest. */
  loyaltyBalance?: number
  codEnabled: boolean
  /** Prefilled for a returning customer. */
  defaultAddress?: AddressSnapshot | null
  defaultEmail?: string
  cartHref?: string
  shopHref?: string
}

export function CheckoutView({
  cart: initialCart,
  loyaltyRules,
  loyaltyBalance = 0,
  codEnabled,
  defaultAddress = null,
  defaultEmail = '',
  cartHref = '/cart',
  shopHref = '/shop',
}: CheckoutViewProps): React.ReactElement {
  const router = useRouter()

  const [cart, setCart] = useState<Cart>(initialCart)
  const [shipping, setShipping] = useState<AddressSnapshot>(defaultAddress ?? EMPTY_ADDRESS)
  const [billing, setBilling] = useState<AddressSnapshot>(EMPTY_ADDRESS)
  const [billingSame, setBillingSame] = useState(true)
  const [email, setEmail] = useState(defaultEmail)
  const [method, setMethod] = useState<PaymentMethod>('razorpay')
  const [loyaltyPointsRequested, setLoyaltyPointsRequested] = useState(0)

  const [submitted, setSubmitted] = useState(false)
  const [couponPending, setCouponPending] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [shortages, setShortages] = useState<CheckoutShortage[]>([])

  // Derived during render rather than mirrored into state: the validity of an address is a pure
  // function of the address, and an effect keeping a second copy of it in sync is the exact
  // pattern that failed lint in an earlier stage.
  const shippingCheck = validateAddress(shipping)
  const billingCheck = billingSame ? shippingCheck : validateAddress(billing)
  const normalisedEmail = normaliseEmail(email)

  // Errors stay hidden until the customer has tried once. A form that turns red while it is
  // still being filled in is a form that is shouting at somebody who has done nothing wrong.
  const shippingErrors = submitted ? shippingCheck.errors : {}
  const billingErrors = submitted && !billingSame ? billingCheck.errors : {}
  const emailError = submitted && normalisedEmail === null ? 'Please enter a valid email address.' : null

  const runCouponAction = async (request: Parameters<typeof postCartAction>[0]): Promise<void> => {
    setCouponPending(true)
    setFormError(null)

    const result = await postCartAction(request)

    if (result.ok) {
      setCart(result.cart)
      router.refresh()
    } else {
      setFormError(result.error)
    }

    setCouponPending(false)
  }

  const handlePlaceOrder = async (): Promise<void> => {
    setSubmitted(true)
    setShortages([])

    if (!shippingCheck.ok || !billingCheck.ok || normalisedEmail === null) {
      setFormError('Please correct the highlighted fields before placing your order.')
      return
    }

    setPlacing(true)
    setFormError(null)

    let response: Response
    try {
      response = await fetch('/api/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The cleaned addresses, not the raw fields — the same normalisation the server will
          // apply, so what was reviewed on screen is what gets snapshotted onto the order.
          shippingAddress: shippingCheck.address,
          billingAddress: billingCheck.address,
          email: normalisedEmail,
          phone: shippingCheck.address.phone,
          paymentMethod: method,
          loyaltyPointsRequested,
        }),
      })
    } catch {
      setFormError(GENERIC_ERROR)
      setPlacing(false)
      return
    }

    const body: unknown = await response.json().catch(() => null)
    const payload = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}

    if (response.ok && typeof payload.redirectUrl === 'string') {
      // A full navigation, not `router.push`: the redirect may point at a payment gateway, and a
      // client-side route transition to an external origin is not a thing Next can do.
      window.location.assign(payload.redirectUrl)
      return
    }

    if (Array.isArray(payload.shortages)) {
      setShortages(payload.shortages as CheckoutShortage[])
    }
    setFormError(typeof payload.error === 'string' ? payload.error : GENERIC_ERROR)
    setPlacing(false)
  }

  if (cart.isEmpty) {
    return (
      <EmptyState
        icon={<BagIcon className="size-10" />}
        title="There is nothing to check out"
        description="Your bag is empty, so there is nothing to pay for yet."
        action={
          <Link
            href={shopHref}
            className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex rounded-[--radius-control] px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out"
          >
            Start shopping
          </Link>
        }
      />
    )
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-12">
      <div className="flex min-w-0 flex-col gap-10">
        {!cart.canCheckout ? (
          <p role="alert" className="border-danger text-danger rounded-[--radius-control] border p-4 text-sm">
            Some items in your bag need attention before you can pay.{' '}
            <Link href={cartHref} className="underline underline-offset-2">
              Go back to your bag
            </Link>
            .
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="checkout-email" className="text-fg text-base font-medium">
            Email
          </label>
          <p className="text-fg-muted text-sm">Your order confirmation and tracking updates go here.</p>
          <input
            id="checkout-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={placing}
            aria-invalid={emailError !== null}
            aria-describedby={emailError !== null ? 'checkout-email-error' : undefined}
            className={`bg-surface text-fg mt-1 w-full max-w-md rounded-[--radius-control] border px-3 py-2 text-sm disabled:opacity-60 ${
              emailError !== null ? 'border-danger' : 'border-border'
            }`}
          />
          {emailError !== null ? (
            <p id="checkout-email-error" className="text-danger text-sm">
              {emailError}
            </p>
          ) : null}
        </div>

        <AddressForm
          legend="Delivery address"
          value={shipping}
          errors={shippingErrors}
          onChange={setShipping}
          disabled={placing}
        />

        <div className="flex flex-col gap-4">
          <label className="text-fg flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={billingSame}
              onChange={(event) => setBillingSame(event.target.checked)}
              disabled={placing}
              className="accent-accent size-4"
            />
            Billing address is the same as delivery
          </label>

          {!billingSame ? (
            <AddressForm
              legend="Billing address"
              value={billing}
              errors={billingErrors}
              onChange={setBilling}
              disabled={placing}
            />
          ) : null}
        </div>

        <PaymentStep
          method={method}
          onMethodChange={setMethod}
          codEnabled={codEnabled}
          codFeePaise={cart.pricing.codFeePaise}
          loyaltyRules={loyaltyRules}
          loyaltyBalance={loyaltyBalance}
          loyaltyPointsAvailable={cart.pricing.loyaltyPointsAvailable}
          loyaltyPointsRequested={loyaltyPointsRequested}
          loyaltyPointsUsed={cart.pricing.loyaltyPointsUsed}
          loyaltyRejection={cart.pricing.loyaltyRejection}
          onLoyaltyPointsChange={setLoyaltyPointsRequested}
          grandTotalPaise={cart.pricing.grandTotalPaise}
          canPlaceOrder={cart.canCheckout}
          pending={placing}
          error={formError}
          onPlaceOrder={() => {
            void handlePlaceOrder()
          }}
        />

        {shortages.length > 0 ? (
          <div role="alert" className="border-danger rounded-[--radius-control] border p-4">
            <p className="text-danger text-sm font-medium">
              Stock moved while you were checking out.
            </p>
            <ul className="text-fg-muted mt-2 flex flex-col gap-1 text-sm">
              {shortages.map((shortage) => {
                const line = cart.lines.find(
                  (candidate) => String(candidate.variantId) === String(shortage.variantId),
                )
                return (
                  <li key={String(shortage.variantId)}>
                    {line?.productTitle ?? 'An item in your bag'}
                    {line?.sizeLabel ? ` (size ${line.sizeLabel})` : ''} — {shortage.available} left,{' '}
                    {shortage.requested} requested.
                  </li>
                )
              })}
            </ul>
            <Link href={cartHref} className="text-accent mt-3 inline-block text-sm underline underline-offset-2">
              Adjust your bag
            </Link>
          </div>
        ) : null}

        <p className="text-fg-subtle text-sm">
          Delivery charges and GST are confirmed against your address when the order is placed.
        </p>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <OrderSummary cart={cart} pending={couponPending}>
          <CouponBox
            couponCode={cart.couponCode}
            rejection={cart.couponRejection}
            pending={couponPending}
            onApply={(code) => {
              void runCouponAction({ action: 'applyCoupon', code })
            }}
            onRemove={() => {
              void runCouponAction({ action: 'removeCoupon' })
            }}
          />
        </OrderSummary>
      </div>
    </div>
  )
}
