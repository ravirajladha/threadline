import Image from 'next/image'
import Link from 'next/link'
import { MAX_LINE_QTY, type CartLineView } from '@/lib/cart/types'
import { Price } from '../ui/Price'
import { CloseIcon, MinusIcon, PlusIcon } from '../ui/icons'

/**
 * One cart line — the row a customer scans to check they bought the right thing in the right
 * size, and the only place a quantity is changed.
 *
 * Every number rendered here was decided by the server. `lineSubtotalPaise` is not recomputed
 * from unit price × quantity, because the cart's totals are priced on `payableQty` (what can
 * actually be sold) rather than on `qty` (what was asked for) — a component that did its own
 * multiplication would disagree with the summary beside it the moment a line went short.
 *
 * The read-only mode exists so the checkout order summary and the cart render the *same* row.
 * A second, near-identical "compact line" component is how a sold-out treatment ends up fixed in
 * one place and not the other.
 */

export interface CartLineProps {
  line: CartLineView
  /** Omitted in `readOnly` mode. Quantity changes are a round trip, hence `pending`. */
  onQtyChange?: (variantId: number | string, qty: number) => void
  onRemove?: (variantId: number | string) => void
  /** True while this line's own mutation is in flight — the controls disable, the row dims. */
  pending?: boolean
  /** No stepper, no remove: the checkout-side summary, where the cart is already fixed. */
  readOnly?: boolean
}

/**
 * The line's problem, in words.
 *
 * `price_changed` is deliberately styled as information rather than as an error: it does not
 * block checkout (see `buildCartView`), the customer is charged the current price, and dressing
 * it in red would teach people to fear a message that means "we did the honest thing".
 */
function LineIssueNotice({ line }: { line: CartLineView }): React.ReactElement | null {
  switch (line.issue) {
    case 'unavailable':
      return (
        <p className="text-danger text-sm font-medium">
          No longer available — remove it to continue.
        </p>
      )
    case 'insufficient_stock':
      return (
        <p className="text-danger text-sm font-medium">
          {line.availableQty === 1 ? 'Only 1 left' : `Only ${line.availableQty} left`} — reduce the
          quantity to continue.
        </p>
      )
    case 'price_changed':
      return (
        <p className="text-fg-muted inline-flex flex-wrap items-baseline gap-1.5 text-sm">
          <span>The price changed since you added this — was</span>
          <Price pricePaise={line.priceAtAddPaise} size="sm" />
          <span>, now</span>
          <Price pricePaise={line.unitPricePaise} size="sm" />
          <span>.</span>
        </p>
      )
    case null:
      return null
  }
}

export function CartLine({
  line,
  onQtyChange,
  onRemove,
  pending = false,
  readOnly = false,
}: CartLineProps): React.ReactElement {
  // Two ceilings on the stepper and the lower wins: what is physically in stock, and the
  // technical guard rail on a single line. Neither is a price, so clamping here cannot put the
  // component at odds with the server's totals — the endpoint clamps again on arrival.
  const maxQty = Math.min(line.maxQty, MAX_LINE_QTY)
  const isBlocked = line.issue === 'unavailable' || line.issue === 'insufficient_stock'
  const isShortPriced = line.payableQty !== line.qty

  return (
    <li
      className={`border-border flex gap-4 border-b py-4 transition-opacity duration-fast ease-out ${
        pending ? 'opacity-60' : ''
      }`}
      aria-busy={pending}
    >
      <div
        className="bg-surface-raised relative w-20 shrink-0 overflow-hidden rounded-[--radius-card] sm:w-24"
        style={{ aspectRatio: '4 / 5' }}
      >
        {line.image ? (
          <Image
            src={line.image.url}
            alt={line.image.alt || line.productTitle}
            fill
            sizes="96px"
            className="object-cover"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {line.productSlug ? (
              <Link
                href={`/p/${line.productSlug}`}
                className="text-fg hover:text-accent line-clamp-2 text-sm font-medium transition-colors duration-fast ease-out"
              >
                {line.productTitle}
              </Link>
            ) : (
              <p className="text-fg line-clamp-2 text-sm font-medium">{line.productTitle}</p>
            )}
            {line.sizeLabel || line.colourName ? (
              <p className="text-fg-muted mt-1 flex items-center gap-2 text-sm">
                {line.colourName ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="border-border-strong size-3 shrink-0 rounded-full border"
                      style={{ backgroundColor: line.colourHex }}
                      aria-hidden="true"
                    />
                    {line.colourName}
                  </span>
                ) : null}
                {line.sizeLabel ? <span>Size {line.sizeLabel}</span> : null}
              </p>
            ) : null}
          </div>

          {!readOnly && onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(line.variantId)}
              disabled={pending}
              aria-label={`Remove ${line.productTitle} from your bag`}
              className="text-fg-subtle hover:text-fg hover:bg-surface-raised shrink-0 rounded-[--radius-control] p-1.5 transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CloseIcon className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          {readOnly ? (
            <p className="text-fg-muted text-sm">
              Qty {line.qty}
              <span className="text-fg-subtle"> · </span>
              <span className="text-fg-subtle">
                <Price pricePaise={line.unitPricePaise} size="sm" /> each
              </span>
            </p>
          ) : (
            <div
              className={`border-border-strong inline-flex items-center rounded-[--radius-control] border ${
                isBlocked ? 'border-danger' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onQtyChange?.(line.variantId, line.qty - 1)}
                disabled={pending || line.qty <= 1 || !onQtyChange}
                aria-label="Decrease quantity"
                className="text-fg p-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MinusIcon className="size-4" />
              </button>
              <span className="text-fg w-10 text-center text-sm tabular-nums">
                <span className="sr-only">Quantity: </span>
                {line.qty}
              </span>
              <button
                type="button"
                onClick={() => onQtyChange?.(line.variantId, line.qty + 1)}
                disabled={pending || line.qty >= maxQty || !onQtyChange}
                aria-label="Increase quantity"
                className="text-fg p-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PlusIcon className="size-4" />
              </button>
            </div>
          )}

          <div className="text-right">
            <Price pricePaise={line.lineSubtotalPaise} />
            {isShortPriced ? (
              <p className="text-fg-subtle text-xs">
                Priced for {line.payableQty} of {line.qty}
              </p>
            ) : null}
          </div>
        </div>

        <LineIssueNotice line={line} />
      </div>
    </li>
  )
}
