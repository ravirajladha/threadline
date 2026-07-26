/**
 * The storefront's one entry point to catalog data.
 *
 * Routes import `getCatalog()` and get a `CatalogPort` — they never construct a Payload client
 * themselves. That keeps the dependency pointing at the interface, and it means the day a page
 * needs to be rendered against a fixture, the change is here and nowhere else.
 *
 * `cache` is React's per-request memo, not a time-based cache: several server components on one
 * page all calling `getCatalog()` share one Payload instance and one catalog read.
 */
import { cache } from 'react'
import { getPayload } from 'payload'

import config from '@payload-config'
import { createPayloadCatalog } from './payloadCatalog'
import type { CatalogPort } from './types'

export const getCatalog = cache(async (): Promise<CatalogPort> => {
  const payload = await getPayload({ config })
  return createPayloadCatalog(payload)
})
