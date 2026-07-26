import { describe, expect, it } from 'vitest'

import { syncVariantStock, type StockLedgerPort } from '@/lib/inventory/syncStock'
import type { StockMovementLike } from '@/lib/inventory/stock'

/**
 * An in-memory ledger. The interface exists precisely so this file needs no database —
 * `createPayloadLedgerPort` is the other implementation of the same contract.
 */
function inMemoryPort(ledger: Record<string, StockMovementLike[]>) {
  const written: Array<{ variantId: number | string; stockQty: number }> = []

  const port: StockLedgerPort = {
    listMovements: async (variantId) => ledger[String(variantId)] ?? [],
    setStockQty: async (variantId, stockQty) => {
      written.push({ variantId, stockQty })
    },
  }

  return { port, written }
}

describe('syncVariantStock', () => {
  it('writes the ledger sum back to the variant', async () => {
    const { port, written } = inMemoryPort({
      '5': [
        { type: 'in', qty: 20 },
        { type: 'out', qty: 6 },
        { type: 'return', qty: 1 },
      ],
    })

    await expect(syncVariantStock(port, 5)).resolves.toBe(15)
    expect(written).toEqual([{ variantId: 5, stockQty: 15 }])
  })

  it('writes zero for a variant with no movements rather than skipping it', async () => {
    // A variant whose last unit was sold must be actively set to 0, not left at its old value.
    const { port, written } = inMemoryPort({})

    await expect(syncVariantStock(port, 'v-9')).resolves.toBe(0)
    expect(written).toEqual([{ variantId: 'v-9', stockQty: 0 }])
  })

  it('is idempotent — syncing twice writes the same figure', async () => {
    const { port, written } = inMemoryPort({ '1': [{ type: 'in', qty: 7 }] })

    await syncVariantStock(port, 1)
    await syncVariantStock(port, 1)

    expect(written).toEqual([
      { variantId: 1, stockQty: 7 },
      { variantId: 1, stockQty: 7 },
    ])
  })

  it('reports a negative balance rather than hiding a discrepancy', async () => {
    const { port } = inMemoryPort({ '3': [{ type: 'in', qty: 2 }, { type: 'out', qty: 5 }] })

    await expect(syncVariantStock(port, 3)).resolves.toBe(-3)
  })
})
