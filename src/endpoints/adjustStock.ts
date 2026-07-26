import type { Endpoint, PayloadRequest } from 'payload'

import { staffIdOf } from '@/access'
import { planReceipt, planStockCorrection, planWriteOff } from '@/lib/inventory/adjustment'
import type { PlannedMovement } from '@/lib/inventory/adjustment'
import { endpoint, json, readJson, requireWrite, routeParam } from './guards'

/**
 * `POST /api/variants/:id/adjust-stock`
 *
 * Body: one of
 * - `{ mode: 'set', targetQty: number, reason: string }` — count says there are N on the shelf
 * - `{ mode: 'receive', qty: number, reason: string }` — a delivery arrived
 * - `{ mode: 'writeOff', qty: number, reason: string }` — units are unsellable
 *
 * The endpoint never writes `stockQty`. It appends a movement and lets the collection's hook
 * recompute the cached figure, which is what keeps the number and its ledger in step — the
 * admin gets a plain "set stock to N" box without `stockQty` ever becoming writable.
 */
async function handler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'catalog')
  if (denied) return denied

  const variantId = routeParam(req, 'id')
  if (!variantId) return json({ error: 'Missing variant id.' }, 400)

  const body = await readJson(req)
  if (!body) return json({ error: 'Expected a JSON body.' }, 400)

  const reason = typeof body.reason === 'string' ? body.reason : ''
  const variant = await req.payload
    .findByID({ collection: 'variants', id: variantId, depth: 0, overrideAccess: true })
    .catch(() => null)

  if (!variant) return json({ error: 'Variant not found.' }, 404)

  let movement: PlannedMovement | null
  try {
    movement = planMovement(body, variant.stockQty ?? 0, reason)
  } catch (error) {
    // These are the value objects rejecting bad input, so the message is already written for
    // a human — "Stock cannot be set to a negative number." beats a generic 400.
    return json({ error: error instanceof Error ? error.message : 'Invalid adjustment.' }, 400)
  }

  if (movement === null) {
    return json({ changed: false, stockQty: variant.stockQty ?? 0, message: 'Stock is already at that figure.' })
  }

  await req.payload.create({
    collection: 'stockMovements',
    data: {
      variant: variant.id,
      type: movement.type,
      qty: movement.qty,
      reason: movement.reason,
      // Only a staff id belongs here — the column is a foreign key into `users`, and the
      // guard above has already established the caller is staff.
      actor: staffIdOf(req.user),
    } as never,
    depth: 0,
    overrideAccess: true,
    req,
  })

  // Re-read rather than compute: the hook is the authority on the new figure, and reporting
  // anything else would be this endpoint guessing at its own side effect.
  const updated = await req.payload.findByID({
    collection: 'variants',
    id: variant.id,
    depth: 0,
    overrideAccess: true,
  })

  req.payload.logger.info(
    `Stock ${movement.type} of ${movement.qty} on variant ${variant.id} by user ${req.user?.id}: ${movement.reason}`,
  )

  return json({ changed: true, movement, stockQty: updated.stockQty ?? 0 })
}

function planMovement(
  body: Record<string, unknown>,
  currentQty: number,
  reason: string,
): PlannedMovement | null {
  const qty = typeof body.qty === 'number' ? body.qty : Number.NaN

  switch (body.mode) {
    case 'set':
      return planStockCorrection(
        currentQty,
        typeof body.targetQty === 'number' ? body.targetQty : Number.NaN,
        reason,
      )
    case 'receive':
      return planReceipt(qty, reason)
    case 'writeOff':
      return planWriteOff(qty, reason)
    default:
      throw new RangeError('mode must be one of: set, receive, writeOff.')
  }
}

export const adjustStockEndpoint: Endpoint = endpoint('/:id/adjust-stock', 'post', handler)
