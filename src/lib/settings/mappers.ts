/**
 * Reading the `settings` global into the shapes the domain expects — the pure half.
 *
 * The pricing layer takes plain data — `ShippingRules`, `LoyaltyRules`, a state name — rather
 * than a Payload document, so that it stays pure. This is the adapter between the two, and it is
 * the only place that knows the global's field names.
 *
 * **Split from the loader deliberately.** `server.ts` beside this file imports `@payload-config` to
 * fetch the global, and `@payload-config` pulls in every collection — so a `lib/` module that only
 * wanted `returnWindowDays` was dragging the whole Payload config in with it, and
 * `collections/Returns.ts` → `endpoints/returns.ts` → this file → the config → `Returns.ts` closed
 * a cycle that left `Returns` undefined at import time. Pure mappers have no business knowing the
 * config exists.
 *
 * Every read has a **documented fallback**. The global is a singleton the owner edits, and a
 * required field can still be missing on a fresh database or immediately after a schema change.
 * The fallbacks are conservative: shipping is charged rather than given away, loyalty is off
 * rather than spendable, and the company state matches the default in the global itself.
 */
import type { LoyaltyRules } from '@/lib/pricing/loyalty'
import type { ShippingRules } from '@/lib/pricing/shipping'
import type { PricingSettings } from '@/lib/pricing/totals'

/** The subset of the global this module reads. Kept structural, so a new field cannot break it. */
export interface SettingsLike {
  freeShippingThreshold?: number | null
  flatShippingRate?: number | null
  codEnabled?: boolean | null
  codFee?: number | null
  companyState?: string | null
  returnWindowDays?: number | null
  loyaltyEnabled?: boolean | null
  loyaltyEarnPerRupee?: number | null
  loyaltyMaxRedeemPct?: number | null
  loyaltyMinRedeem?: number | null
}

/** Paise, floored at zero — a negative shipping rate would pay the customer to order. */
function paise(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback

  return Math.max(0, Math.round(value))
}

function count(value: number | null | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback

  return Math.min(Math.max(0, Math.floor(value)), max)
}

export function toShippingRules(settings: SettingsLike): ShippingRules {
  return {
    // A missing threshold must not mean "everything ships free".
    freeShippingThresholdPaise: paise(settings.freeShippingThreshold, 99900),
    flatShippingRatePaise: paise(settings.flatShippingRate, 7900),
    codEnabled: settings.codEnabled === true,
    codFeePaise: paise(settings.codFee, 0),
  }
}

export function toLoyaltyRules(settings: SettingsLike): LoyaltyRules {
  return {
    // Off unless explicitly on: points are money, and defaulting them to spendable on a
    // half-configured store hands out discounts nobody authorised.
    enabled: settings.loyaltyEnabled === true,
    earnPerRupee: count(settings.loyaltyEarnPerRupee, 1),
    maxRedeemPct: count(settings.loyaltyMaxRedeemPct, 10, 100),
    minRedeem: count(settings.loyaltyMinRedeem, 50),
  }
}

export function toPricingSettings(settings: SettingsLike): PricingSettings {
  return {
    shipping: toShippingRules(settings),
    loyalty: toLoyaltyRules(settings),
    companyState: typeof settings.companyState === 'string' && settings.companyState.trim().length > 0
      ? settings.companyState
      : 'Karnataka',
  }
}

/** Days after delivery in which a return may be raised. Used from J8. */
export function returnWindowDays(settings: SettingsLike): number {
  return count(settings.returnWindowDays, 7)
}
