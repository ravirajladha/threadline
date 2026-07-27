/**
 * GST.
 *
 * Two rules, and both of them are the kind that quietly produce a wrong invoice if you get
 * them slightly wrong.
 *
 * **Jurisdiction.** A sale within the seller's own state is CGST + SGST, split evenly. A sale
 * to any other state is IGST at the full rate. It is never both, and never neither.
 *
 * **The split is floor + remainder, not two halves.** Computing cgst and sgst as separate
 * 50% roundings of an odd paise amount gives two values that sum to one paise more than the
 * tax they came from — a reconciliation failure that appears on roughly half of all orders
 * and on none of the round-numbered ones you would test by hand. So one half is computed and
 * the other is whatever is left, which makes `cgst + sgst === tax` true by construction.
 *
 * Tax here is **added to** the line amount rather than extracted from it, per `docs/SCHEMA.md`
 * (`lineTotal` = unitPrice × qty, plus tax). If the owner decides displayed prices are meant
 * to be GST-inclusive, this module is the single place that changes — see CLAUDE.md §7.
 */
import { Money } from './money'
import type { TaxJurisdiction } from '@/types'

/** The three GST components. Exactly one side of the split is ever non-zero. */
export interface TaxBreakup {
  cgst: Money
  sgst: Money
  igst: Money
}

/**
 * Normalise a state name for comparison.
 *
 * The seller's state comes from `settings` and the buyer's from an address the customer typed,
 * so "karnataka", "Karnataka" and " Karnataka " all have to mean the same state. Getting this
 * wrong charges IGST on a local sale, which is a filing problem rather than a display bug.
 */
export function normaliseState(state: string): string {
  return state.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Which GST applies.
 *
 * An unknown or empty destination is treated as `intra_state` — the seller's own state — because
 * that is the case the cart page shows before an address exists, and it is the conservative
 * default: it never invents an inter-state sale out of missing data. Checkout recomputes this
 * the moment a real shipping address is chosen.
 */
export function taxJurisdiction(sellerState: string, shippingState: string | null): TaxJurisdiction {
  if (shippingState === null || shippingState.trim().length === 0) return 'intra_state'

  return normaliseState(sellerState) === normaliseState(shippingState) ? 'intra_state' : 'inter_state'
}

/** Tax on a taxable amount at a whole-or-fractional percentage rate (5, 12, 18…). */
export function taxOn(taxableAmount: Money, ratePct: number): Money {
  if (!Number.isFinite(ratePct) || ratePct < 0) {
    throw new RangeError(`Tax rate must be a non-negative finite number, received ${ratePct}`)
  }

  return taxableAmount.percentage(ratePct)
}

/**
 * Split a tax amount into its components.
 *
 * `cgst + sgst + igst === tax` always holds. The odd paise on an intra-state split goes to
 * SGST, which is arbitrary but has to be decided somewhere rather than left to rounding.
 */
export function splitTax(tax: Money, jurisdiction: TaxJurisdiction): TaxBreakup {
  if (jurisdiction === 'inter_state') {
    return { cgst: Money.zero(), sgst: Money.zero(), igst: tax }
  }

  const half = Money.fromPaise(Math.floor(tax.toPaise() / 2))

  return { cgst: half, sgst: tax.subtract(half), igst: Money.zero() }
}

/** Add two breakups. Used to total a cart line by line without losing the split. */
export function addBreakups(a: TaxBreakup, b: TaxBreakup): TaxBreakup {
  return {
    cgst: a.cgst.add(b.cgst),
    sgst: a.sgst.add(b.sgst),
    igst: a.igst.add(b.igst),
  }
}

export function emptyBreakup(): TaxBreakup {
  return { cgst: Money.zero(), sgst: Money.zero(), igst: Money.zero() }
}

/** The total of a breakup. Should equal the tax it was split from. */
export function breakupTotal(breakup: TaxBreakup): Money {
  return breakup.cgst.add(breakup.sgst).add(breakup.igst)
}
