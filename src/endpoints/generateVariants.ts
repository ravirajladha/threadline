import type { Endpoint, PayloadRequest } from 'payload'

import { planVariantMatrix } from '@/lib/inventory/variantMatrix'
import { endpoint, json, readJson, requireWrite, routeParam, toIdList } from './guards'

/**
 * `POST /api/products/:id/generate-variants`
 *
 * Body: `{ sizes: id[], colours: id[], dryRun?: boolean }`
 *
 * Creates the missing cells of the size × colour matrix for one product. The decision of which
 * cells are missing is `planVariantMatrix`'s, which is unit tested; this handler resolves ids,
 * checks the role and writes.
 *
 * `dryRun` returns the plan without creating anything, so the admin UI can say "this will
 * create 12 variants and skip 3" before the owner commits to it.
 */
async function handler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'catalog')
  if (denied) return denied

  const productId = routeParam(req, 'id')
  if (!productId) return json({ error: 'Missing product id.' }, 400)

  const body = await readJson(req)
  if (!body) return json({ error: 'Expected a JSON body.' }, 400)

  const sizeIds = toIdList(body.sizes)
  const colourIds = toIdList(body.colours)
  const dryRun = body.dryRun === true

  if (sizeIds.length === 0 || colourIds.length === 0) {
    return json({ error: 'Select at least one size and one colour.' }, 400)
  }

  const product = await req.payload
    .findByID({ collection: 'products', id: productId, depth: 0, overrideAccess: true })
    .catch(() => null)

  if (!product) return json({ error: 'Product not found.' }, 404)

  // Resolve the selection to labels — ids alone cannot build a SKU. Fetching by id list rather
  // than one at a time keeps this a fixed number of queries however wide the matrix is.
  const [sizes, colours, existing] = await Promise.all([
    req.payload.find({
      collection: 'sizes',
      where: { id: { in: sizeIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
    req.payload.find({
      collection: 'colours',
      where: { id: { in: colourIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
    req.payload.find({
      collection: 'variants',
      where: { product: { equals: productId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
  ])

  if (sizes.docs.length !== sizeIds.length || colours.docs.length !== colourIds.length) {
    return json({ error: 'One or more of the selected sizes or colours no longer exists.' }, 400)
  }

  let plan
  try {
    plan = planVariantMatrix(
      product.title,
      sizes.docs.map((size) => ({ id: size.id, label: size.label })),
      colours.docs.map((colour) => ({ id: colour.id, name: colour.name })),
      existing.docs.map((variant) => ({
        size: typeof variant.size === 'object' ? variant.size.id : variant.size,
        colour: typeof variant.colour === 'object' ? variant.colour.id : variant.colour,
      })),
    )
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not plan the matrix.' }, 400)
  }

  if (dryRun) {
    return json({ dryRun: true, created: 0, ...summarise(plan) })
  }

  // Sequential rather than parallel: each insert competes for the same unique index on
  // (product, size, colour), and a burst of parallel writes turns a clean skip into a
  // constraint violation the owner has to interpret.
  const created: string[] = []
  for (const planned of plan.create) {
    const variant = await req.payload.create({
      collection: 'variants',
      data: {
        product: product.id,
        size: planned.size,
        colour: planned.colour,
        sku: planned.sku,
        price: product.mrp,
        isActive: true,
      } as never,
      depth: 0,
      overrideAccess: true,
      req,
    })

    created.push(String((variant as { sku?: unknown }).sku ?? planned.sku))
  }

  req.payload.logger.info(
    `Generated ${created.length} variants for product ${product.id} by user ${req.user?.id}`,
  )

  return json({ dryRun: false, created: created.length, skus: created, ...summarise(plan) })
}

function summarise(plan: ReturnType<typeof planVariantMatrix>) {
  return {
    willCreate: plan.create.length,
    skipped: plan.skipped,
    requested: plan.requested,
    preview: plan.create.map((v) => ({ sku: v.sku, size: v.sizeLabel, colour: v.colourName })),
  }
}

export const generateVariantsEndpoint: Endpoint = endpoint(
  '/:id/generate-variants',
  'post',
  handler,
)
