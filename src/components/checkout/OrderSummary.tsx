import type { CartView } from '@/lib/cart/types'
import { CartLine } from '../cart/CartLine'
import { CartSummary } from '../cart/CartSummary'

/**
 * The persistent summary that sits beside the checkout form.
 *
 * It renders the *same* `CartLine` and `CartSummary` the cart page does, in read-only mode.
 * DESIGN.md asks for a summary the customer can keep glancing at while they type an address, and
 * the tempting shortcut is a stripped-down copy of both — which is how a store ends up showing
 * one delivery charge on the cart and a different one at checkout. There is one totals renderer
 * in this codebase, and this is it, wearing a different heading.
 */

export interface OrderSummaryProps {
  cart: CartView
  /** The coupon box, slotted in by the checkout page. Kept a slot so this stays presentational. */
  children?: React.ReactNode
  /** True while the cart is being re-read after a coupon change. */
  pending?: boolean
}

export function OrderSummary({ cart, children, pending = false }: OrderSummaryProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <details open className="border-border bg-surface rounded-[--radius-card] border p-4 md:p-6">
        <summary className="text-fg cursor-pointer list-none text-base font-medium">
          {cart.pricing.itemCount === 1 ? '1 item in this order' : `${cart.pricing.itemCount} items in this order`}
        </summary>
        <ul className="border-border mt-2 flex flex-col border-t">
          {cart.lines.map((line) => (
            <CartLine key={String(line.variantId)} line={line} readOnly />
          ))}
        </ul>
      </details>

      {children ? <div className="border-border bg-surface rounded-[--radius-card] border p-4 md:p-6">{children}</div> : null}

      <CartSummary pricing={cart.pricing} heading="Total" pending={pending} />
    </div>
  )
}
