/**
 * Pure operations on a cart's item list.
 *
 * Every one returns a **new array**, so a caller cannot accidentally mutate the document it
 * read. All of them clamp: a quantity arrives from a request body, which means it can be 0,
 * -3, 2.5, `1e9` or the string "2", and none of those may reach the database.
 *
 * Two behaviours worth stating because the alternative is a common bug:
 *
 * **Adding a variant already in the cart increases that line**, rather than appending a second
 * one. A cart with "Oxford Shirt / M / Blue" twice is a cart whose quantity stepper lies.
 *
 * **A quantity of zero removes the line.** The stepper's decrement below one and the bin icon
 * are then the same operation, which is one code path instead of two that must agree.
 */
import { MAX_LINE_QTY, type CartItem } from './types'

/** Ids compared as strings, because Payload returns a number here and a string there. */
function sameVariant(item: CartItem, variantId: number | string): boolean {
  return String(item.variantId) === String(variantId)
}

/**
 * Coerce an untrusted quantity to a whole number within bounds.
 *
 * Returns 0 for anything unusable, which the callers treat as "remove the line" — a malformed
 * quantity is never a reason to throw a 500 at a shopper.
 */
export function normaliseQty(value: unknown, ceiling = MAX_LINE_QTY): number {
  const raw = typeof value === 'string' ? Number(value) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0

  const whole = Math.floor(raw)
  if (whole <= 0) return 0

  return Math.min(whole, Math.max(0, Math.floor(ceiling)))
}

export function findLine(items: readonly CartItem[], variantId: number | string): CartItem | null {
  return items.find((item) => sameVariant(item, variantId)) ?? null
}

/**
 * Add units of a variant.
 *
 * `available` is the units the server says exist; the line is clamped to it as well as to
 * `MAX_LINE_QTY`. Adding to a sold-out variant is a no-op rather than an error, because the
 * honest answer — "there are none" — is already on the page the shopper is looking at.
 */
export function addLine(
  items: readonly CartItem[],
  input: { variantId: number | string; qty: number; pricePaise: number; available: number },
): CartItem[] {
  const ceiling = Math.min(MAX_LINE_QTY, Math.max(0, Math.floor(input.available)))
  const requested = normaliseQty(input.qty, ceiling)
  if (requested === 0) return [...items]

  const existing = findLine(items, input.variantId)

  if (existing === null) {
    return [...items, { variantId: input.variantId, qty: requested, priceAtAddPaise: input.pricePaise }]
  }

  const combined = Math.min(existing.qty + requested, ceiling)

  return items.map((item) =>
    sameVariant(item, input.variantId) ? { ...item, qty: combined } : item,
  )
}

/**
 * Set a line to an exact quantity. Zero — or anything that normalises to zero — removes it.
 *
 * `priceAtAddPaise` is deliberately left alone. It records what the shopper saw when they first
 * added the item; changing the quantity does not change what they were shown.
 */
export function setLineQty(
  items: readonly CartItem[],
  input: { variantId: number | string; qty: number; available: number },
): CartItem[] {
  const ceiling = Math.min(MAX_LINE_QTY, Math.max(0, Math.floor(input.available)))
  const qty = normaliseQty(input.qty, ceiling)

  if (qty === 0) return removeLine(items, input.variantId)

  return items.map((item) => (sameVariant(item, input.variantId) ? { ...item, qty } : item))
}

export function removeLine(items: readonly CartItem[], variantId: number | string): CartItem[] {
  return items.filter((item) => !sameVariant(item, variantId))
}

/**
 * Drop anything that is no longer sellable and clamp the rest to what is left.
 *
 * Run on every cart read. A cart is long-lived, so between two visits a variant can be
 * deactivated, sold out, or reduced to fewer units than the shopper is holding — and the cart
 * has to reflect that rather than carry a line into checkout that cannot be fulfilled.
 */
export function reconcileLines(
  items: readonly CartItem[],
  availabilityOf: (variantId: number | string) => number,
): CartItem[] {
  const reconciled: CartItem[] = []

  for (const item of items) {
    const available = Math.max(0, Math.floor(availabilityOf(item.variantId)))
    if (available === 0) continue

    reconciled.push({ ...item, qty: Math.min(item.qty, available, MAX_LINE_QTY) })
  }

  return reconciled
}

/** Total units in the cart, for the header badge. */
export function itemCount(items: readonly CartItem[]): number {
  return items.reduce((total, item) => total + item.qty, 0)
}
