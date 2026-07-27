/**
 * Turning a priced cart into an order.
 *
 * Pure, and that is the point: the moment an order is written is the moment its numbers stop
 * being negotiable, so the arithmetic that produces them is built and tested without a database
 * anywhere near it.
 *
 * Two properties this module is responsible for.
 *
 * **Every line is snapshotted in full.** Title, size label, colour name, image, unit price, tax
 * rate — all copied. `variant` is kept as a reference for returns and reporting, and nothing on
 * an invoice is ever read through it. A product renamed, repriced or archived next month must not
 * rewrite an order placed today.
 *
 * **The line items reconcile against the order totals.** `assertDraftReconciles` re-adds the
 * items and compares them with the columns, so an order whose invoice does not add up cannot be
 * written in the first place.
 */
import { Money } from '@/lib/pricing/money'
import type { CartLineView } from '@/lib/cart/types'
import type { CartPricing } from '@/lib/pricing/totals'
import type { OrderStatus, PaymentMethod, PaymentStatus } from '@/types'
import type { AddressSnapshot } from './address'

/** One order line, ready to insert. Mirrors `orderItems`. */
export interface OrderItemDraft {
  variant: number | string
  sku: string
  productTitle: string
  sizeLabel: string
  colourName: string
  image: number | null
  qty: number
  unitPrice: number
  taxRatePct: number
  taxAmount: number
  /** unitPrice × qty, plus tax. */
  lineTotal: number
}

/** The order row, ready to insert. Mirrors `orders`. All money is integer paise. */
export interface OrderRowDraft {
  orderNumber: string
  customer: number | string | null
  email: string
  phone: string | null
  shippingAddress: AddressSnapshot
  billingAddress: AddressSnapshot
  status: OrderStatus
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  subtotal: number
  shipping: number
  taxTotal: number
  discount: number
  loyaltyDiscount: number
  grandTotal: number
  taxBreakup: { cgst: number; sgst: number; igst: number }
  coupon: number | string | null
  placedAt: string
}

export interface OrderDraft {
  order: OrderRowDraft
  items: OrderItemDraft[]
  /** Points spent, for the `loyaltyTransactions` row the port writes alongside. */
  loyaltyPointsUsed: number
  /** Points this order will earn, awarded on delivery, not now. */
  pointsToEarn: number
}

export interface BuildOrderDraftInput {
  orderNumber: string
  customerId: number | string | null
  email: string
  phone: string | null
  shippingAddress: AddressSnapshot
  billingAddress: AddressSnapshot
  /** The cart's lines. Only those with something payable become order items. */
  lines: readonly CartLineView[]
  pricing: CartPricing
  paymentMethod: PaymentMethod
  placedAt: Date
}

export class EmptyOrderError extends Error {
  constructor() {
    super('An order needs at least one line that can be fulfilled')
    this.name = 'EmptyOrderError'
  }
}

export class DraftReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftReconciliationError'
  }
}

/**
 * A **COD order is placed unpaid but confirmed**; a prepaid one waits at `pending` until the
 * gateway says otherwise. Getting this the other way round either ships goods nobody paid for or
 * leaves every cash order stuck behind a payment that will never arrive.
 */
function initialState(paymentMethod: PaymentMethod): { status: OrderStatus; paymentStatus: PaymentStatus } {
  return paymentMethod === 'cod'
    ? { status: 'confirmed', paymentStatus: 'pending' }
    : { status: 'pending', paymentStatus: 'pending' }
}

export function buildOrderDraft(input: BuildOrderDraftInput): OrderDraft {
  const { orderNumber, customerId, email, phone, shippingAddress, billingAddress, lines, pricing, paymentMethod, placedAt } =
    input

  // Tax is per line and computed by the pricing layer; matching by variant keeps this module
  // from recomputing it and quietly disagreeing with the totals it is about to write.
  const taxByVariant = new Map(pricing.lines.map((line) => [String(line.variantId), line]))

  const items: OrderItemDraft[] = []

  for (const line of lines) {
    if (line.payableQty <= 0) continue

    const priced = taxByVariant.get(String(line.variantId))
    if (priced === undefined) continue

    items.push({
      variant: line.variantId,
      sku: line.sku,
      productTitle: line.productTitle,
      sizeLabel: line.sizeLabel,
      colourName: line.colourName,
      image: line.image?.id ?? null,
      qty: priced.qty,
      unitPrice: priced.unitPrice.toPaise(),
      taxRatePct: priced.taxRatePct,
      taxAmount: priced.tax.toPaise(),
      lineTotal: priced.lineTotal.toPaise(),
    })
  }

  if (items.length === 0) throw new EmptyOrderError()

  const { status, paymentStatus } = initialState(paymentMethod)

  const order: OrderRowDraft = {
    orderNumber,
    customer: customerId,
    email,
    phone,
    shippingAddress,
    billingAddress,
    status,
    paymentMethod,
    paymentStatus,
    subtotal: pricing.subtotal.toPaise(),
    shipping: pricing.shipping.toPaise(),
    taxTotal: pricing.taxTotal.toPaise(),
    discount: pricing.discount.toPaise(),
    loyaltyDiscount: pricing.loyaltyDiscount.toPaise(),
    grandTotal: pricing.grandTotal.toPaise(),
    taxBreakup: {
      cgst: pricing.taxBreakup.cgst.toPaise(),
      sgst: pricing.taxBreakup.sgst.toPaise(),
      igst: pricing.taxBreakup.igst.toPaise(),
    },
    coupon: pricing.coupon?.id ?? null,
    placedAt: placedAt.toISOString(),
  }

  const draft: OrderDraft = {
    order,
    items,
    loyaltyPointsUsed: pricing.loyaltyPointsUsed,
    pointsToEarn: pricing.pointsToEarn,
  }

  assertDraftReconciles(draft)

  return draft
}

/**
 * Re-add the items and check them against the order's own columns.
 *
 * The columns were produced by the pricing layer and the items by the loop above, so this
 * catches a line silently dropped, a quantity that did not survive the copy, or a tax total
 * that no longer matches its parts. It is the last gate before an order becomes permanent.
 */
export function assertDraftReconciles(draft: OrderDraft): void {
  const { order, items } = draft

  const itemSubtotal = Money.sum(items.map((item) => Money.fromPaise(item.unitPrice).multiply(item.qty)))
  const itemTax = Money.sum(items.map((item) => Money.fromPaise(item.taxAmount)))
  const itemTotal = Money.sum(items.map((item) => Money.fromPaise(item.lineTotal)))

  if (itemSubtotal.toPaise() !== order.subtotal) {
    throw new DraftReconciliationError(
      `Order items sum to ${itemSubtotal.toPaise()} paise but the order subtotal is ${order.subtotal}`,
    )
  }
  if (itemTax.toPaise() !== order.taxTotal) {
    throw new DraftReconciliationError(
      `Order item tax sums to ${itemTax.toPaise()} paise but the order tax total is ${order.taxTotal}`,
    )
  }

  const breakup = order.taxBreakup.cgst + order.taxBreakup.sgst + order.taxBreakup.igst
  if (breakup !== order.taxTotal) {
    throw new DraftReconciliationError(
      `The tax breakup sums to ${breakup} paise but the tax total is ${order.taxTotal}`,
    )
  }
  if (order.taxBreakup.igst > 0 && (order.taxBreakup.cgst > 0 || order.taxBreakup.sgst > 0)) {
    throw new DraftReconciliationError('An order cannot carry both IGST and CGST/SGST')
  }

  const expectedGrand = itemTotal
    .add(Money.fromPaise(order.shipping))
    .subtract(Money.fromPaise(order.discount))
    .subtract(Money.fromPaise(order.loyaltyDiscount))

  if (expectedGrand.toPaise() !== order.grandTotal) {
    throw new DraftReconciliationError(
      `Order lines plus shipping less discounts is ${expectedGrand.toPaise()} paise but the grand total is ${order.grandTotal}`,
    )
  }
  if (order.grandTotal < 0) {
    throw new DraftReconciliationError(`An order cannot have a negative total (${order.grandTotal} paise)`)
  }
}

/** The reservation requests an order's items imply, for the port to hold or commit. */
export function reservationRequestsFor(draft: OrderDraft): Array<{ variantId: number | string; qty: number }> {
  return draft.items.map((item) => ({ variantId: item.variant, qty: item.qty }))
}
