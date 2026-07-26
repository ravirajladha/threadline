import type { Endpoint, PayloadRequest } from 'payload'

import { exportVariantsCsv, parseVariantCsv } from '@/lib/csv/catalogCsv'
import type { ExportableVariant, RowError } from '@/lib/csv/catalogCsv'
import { planStockCorrection } from '@/lib/inventory/adjustment'
import { staffIdOf } from '@/access'
import { endpoint, json, requireWrite } from './guards'

/** Read a relationship that may be an id or a populated doc, returning one text field. */
function label(value: unknown, field: string): string {
  if (value !== null && typeof value === 'object') {
    const populated = (value as Record<string, unknown>)[field]
    if (typeof populated === 'string') return populated
  }
  return ''
}

/**
 * `GET /api/variants/export-csv`
 *
 * The whole catalog at variant level, as a download. Depth 2 so the product's category comes
 * back populated in the same query rather than N+1 lookups per row.
 */
async function exportHandler(req: PayloadRequest): Promise<Response> {
  // Export is a bulk read of the entire catalog, so it takes the same permission as editing it
  // rather than the read any signed-in staff member has.
  const denied = requireWrite(req, 'catalog')
  if (denied) return denied

  const { docs } = await req.payload.find({
    collection: 'variants',
    pagination: false,
    depth: 2,
    overrideAccess: true,
    sort: 'sku',
  })

  const rows: ExportableVariant[] = docs.map((variant) => {
    const product = variant.product as Record<string, unknown> | number | string

    return {
      sku: variant.sku,
      productTitle: label(product, 'title'),
      categoryTitle:
        typeof product === 'object' && product !== null
          ? label((product as Record<string, unknown>).category, 'title')
          : '',
      sizeLabel: label(variant.size, 'label'),
      colourName: label(variant.colour, 'name'),
      pricePaise: variant.price ?? null,
      compareAtPricePaise: variant.compareAtPrice ?? null,
      stockQty: variant.stockQty ?? 0,
      reservedQty: variant.reservedQty ?? 0,
      weightGrams: variant.weightGrams ?? null,
      barcode: variant.barcode ?? null,
      isActive: variant.isActive !== false,
    }
  })

  const filename = `threadline-catalog-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(exportVariantsCsv(rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // The catalog is business data — never let a proxy or the browser keep a copy.
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * `POST /api/variants/import-csv`
 *
 * Body: the raw CSV as `text/csv`, or `{ csv: string, dryRun?: boolean }` as JSON.
 *
 * **Dry run by default.** An import that silently repriced 400 variants because a column was
 * misread is not recoverable from the admin, so committing is an explicit `dryRun: false`.
 * Validation errors are returned in full rather than one at a time — someone fixing a
 * spreadsheet needs the whole list.
 *
 * Stock is never written directly: a changed `stockQty` becomes an `adjust` movement, so an
 * import lands in the ledger like every other stock change and is just as explainable.
 */
async function importHandler(req: PayloadRequest): Promise<Response> {
  const denied = requireWrite(req, 'catalog')
  if (denied) return denied

  const { csv, dryRun } = await readImportBody(req)
  if (csv === null) return json({ error: 'Expected CSV content.' }, 400)

  const { updates, errors } = parseVariantCsv(csv)

  const applied: string[] = []
  const notFound: string[] = []
  const stockChanges: Array<{ sku: string; from: number; to: number }> = []

  for (const update of updates) {
    const { docs } = await req.payload.find({
      collection: 'variants',
      where: { sku: { equals: update.sku } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    const variant = docs[0]
    if (!variant) {
      notFound.push(update.sku)
      continue
    }

    const currentStock = variant.stockQty ?? 0
    const movement =
      update.targetStockQty === null
        ? null
        : planStockCorrection(currentStock, update.targetStockQty, `CSV import (${update.sku})`)

    if (movement) {
      stockChanges.push({ sku: update.sku, from: currentStock, to: update.targetStockQty ?? 0 })
    }

    if (dryRun) {
      applied.push(update.sku)
      continue
    }

    await req.payload.update({
      collection: 'variants',
      id: variant.id,
      data: {
        price: update.pricePaise ?? undefined,
        compareAtPrice: update.compareAtPricePaise ?? undefined,
        weightGrams: update.weightGrams ?? undefined,
        barcode: update.barcode ?? undefined,
        isActive: update.isActive,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })

    if (movement) {
      await req.payload.create({
        collection: 'stockMovements',
        data: {
          variant: variant.id,
          type: movement.type,
          qty: movement.qty,
          reason: movement.reason,
          actor: staffIdOf(req.user),
        } as never,
        depth: 0,
        overrideAccess: true,
        req,
      })
    }

    applied.push(update.sku)
  }

  const unknownSkuErrors: RowError[] = notFound.map((sku) => ({
    line: 0,
    column: 'sku',
    message: `No variant with SKU ${sku}. Import cannot create variants — use the variant generator.`,
  }))

  if (!dryRun) {
    req.payload.logger.info(
      `CSV import applied to ${applied.length} variants by user ${req.user?.id}`,
    )
  }

  return json({
    dryRun,
    parsed: updates.length,
    applied: applied.length,
    notFound,
    stockChanges,
    errors: [...errors, ...unknownSkuErrors],
  })
}

async function readImportBody(
  req: PayloadRequest,
): Promise<{ csv: string | null; dryRun: boolean }> {
  const contentType = req.headers?.get?.('content-type') ?? ''

  try {
    if (contentType.includes('text/csv')) {
      const text = await req.text?.()
      // Raw upload has nowhere to carry a flag, so it takes the safe default.
      return { csv: typeof text === 'string' && text.length > 0 ? text : null, dryRun: true }
    }

    const body: unknown = await req.json?.()
    if (typeof body !== 'object' || body === null) return { csv: null, dryRun: true }

    const record = body as Record<string, unknown>
    return {
      csv: typeof record.csv === 'string' && record.csv.length > 0 ? record.csv : null,
      dryRun: record.dryRun !== false,
    }
  } catch {
    return { csv: null, dryRun: true }
  }
}

export const exportCatalogCsvEndpoint: Endpoint = endpoint('/export-csv', 'get', exportHandler)

export const importCatalogCsvEndpoint: Endpoint = endpoint('/import-csv', 'post', importHandler)
