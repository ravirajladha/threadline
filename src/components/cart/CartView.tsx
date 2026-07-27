'use client'
// Interactive: owns the live cart, the one place quantity and removal round-trip to the server.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { postCartAction, type CartActionRequest } from '@/lib/cart/client'
import type { CartLineIssue, CartView as Cart } from '@/lib/cart/types'
import { CartLine } from './CartLine'
import { CartSummary } from './CartSummary'
import { EmptyState } from '../ui/EmptyState'
import { BagIcon } from '../ui/icons'

/**
 * The cart page body.
 *
 * It holds the cart in state and replaces it wholesale with whatever `/api/cart` hands back —
 * never with a locally patched copy. Optimistically decrementing a quantity here would mean the
 * component owned a version of the truth, and the first time the server clamped a line to what
 * was actually in stock the two would silently disagree about what the customer is buying.
 *
 * The prop seeds the first render only. That is intentional and is not the banned
 * "copy props into state in an effect" pattern: after the first mutation the endpoint's answer
 * *is* the server's answer, so there is nothing newer to synchronise from.
 */

/** Why the checkout button is held. Copy lives with the presentation, the reasons with the domain. */
function blockingMessage(issues: readonly CartLineIssue[]): string | null {
  if (issues.includes('unavailable')) {
    return 'Some items in your bag are no longer available. Remove them to continue.'
  }
  if (issues.includes('insufficient_stock')) {
    return 'Some items are short of stock. Reduce the quantities to continue.'
  }

  return null
}

export interface CartViewProps {
  /** The server-rendered cart. Seeds the first render; mutations replace it. */
  cart: Cart
  /** Where the checkout CTA points. A prop so the route stays the page's decision, not this one's. */
  checkoutHref?: string
  /** Where "keep shopping" goes from an empty bag. */
  shopHref?: string
}

export function CartView({
  cart: initialCart,
  checkoutHref = '/checkout',
  shopHref = '/shop',
}: CartViewProps): React.ReactElement {
  const router = useRouter()
  const [cart, setCart] = useState<Cart>(initialCart)
  const [pendingVariantId, setPendingVariantId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (variantId: number | string, request: CartActionRequest): Promise<void> => {
    setPendingVariantId(String(variantId))
    setError(null)

    const result = await postCartAction(request)

    if (result.ok) {
      setCart(result.cart)
      // Everything else rendered from the cart on the server — the header's bag count above all —
      // is stale the moment this succeeds.
      router.refresh()
    } else {
      setError(result.error)
    }

    setPendingVariantId(null)
  }

  const handleQtyChange = (variantId: number | string, qty: number): void => {
    // Zero is the endpoint's own "remove" spelling; there is no need for a second call shape.
    void run(variantId, { action: 'setQty', variantId, qty })
  }

  const handleRemove = (variantId: number | string): void => {
    void run(variantId, { action: 'remove', variantId })
  }

  if (cart.isEmpty) {
    return (
      <EmptyState
        icon={<BagIcon className="size-10" />}
        title="Your bag is empty"
        description="Nothing in here yet. Have a look at what has just landed."
        action={
          <Link
            href={shopHref}
            className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex rounded-control px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out"
          >
            Start shopping
          </Link>
        }
      />
    )
  }

  const blocked = blockingMessage(cart.blockingIssues)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
      <div className="min-w-0">
        <ul className="border-border flex flex-col border-t">
          {cart.lines.map((line) => (
            <CartLine
              key={String(line.variantId)}
              line={line}
              pending={pendingVariantId === String(line.variantId)}
              onQtyChange={handleQtyChange}
              onRemove={handleRemove}
            />
          ))}
        </ul>

        {/* One live region for the whole list, so a screen reader hears the outcome once. */}
        <div aria-live="assertive" className="mt-4">
          {error ? <p className="text-danger text-sm font-medium">{error}</p> : null}
        </div>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <CartSummary
          pricing={cart.pricing}
          pending={pendingVariantId !== null}
          footer={
            <div className="flex flex-col gap-3">
              {cart.canCheckout ? (
                <Link
                  href={checkoutHref}
                  className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex justify-center rounded-control px-6 py-3 text-sm font-medium transition-colors duration-fast ease-out"
                >
                  Checkout
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-describedby={blocked ? 'cart-blocked' : undefined}
                  className="bg-accent text-accent-fg cursor-not-allowed rounded-control px-6 py-3 text-sm font-medium opacity-60"
                >
                  Checkout
                </button>
              )}

              {blocked ? (
                <p id="cart-blocked" className="text-danger text-sm">
                  {blocked}
                </p>
              ) : null}

              <Link
                href={shopHref}
                className="text-fg-muted hover:text-fg text-center text-sm transition-colors duration-fast ease-out"
              >
                Keep shopping
              </Link>
            </div>
          }
        />
      </div>
    </div>
  )
}
