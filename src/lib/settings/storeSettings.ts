/**
 * Loading the `settings` global.
 *
 * Split from `mappers.ts` because this half imports `@payload-config`, which pulls in every
 * collection — see the note there on the import cycle that caused.
 */
import { cache } from 'react'
import { getPayload, type Payload } from 'payload'

import config from '@payload-config'
import { toPricingSettings, type SettingsLike } from './mappers'
import type { PricingSettings } from '@/lib/pricing/totals'

export * from './mappers'

/**
 * Load the global and map it.
 *
 * `cache` is React's per-request memo: a checkout page that prices a cart, renders a summary and
 * validates a coupon reads the global once, not three times.
 */
export const loadPricingSettings = cache(async (payload?: Payload): Promise<PricingSettings> => {
  const client = payload ?? (await getPayload({ config }))
  const settings = await client.findGlobal({ slug: 'settings', depth: 0, overrideAccess: true })

  return toPricingSettings(settings as SettingsLike)
})
