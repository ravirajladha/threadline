/**
 * Expanding a size × colour selection into variants.
 *
 * Creating an Oxford shirt in 5 sizes and 3 colours is 15 near-identical rows. Doing that by
 * hand is where a real catalog acquires its typos — a missing size in one colour, two spellings
 * of the same navy, a SKU that does not match its siblings. This module turns the whole matrix
 * into one action.
 *
 * Pure by design: the admin endpoint supplies the existing rows and persists the result, and
 * everything interesting — which combinations are new, what each SKU is, what happens when the
 * selection overlaps what is already there — is decided here, where it can be tested.
 */
import { buildSku } from './sku'

export interface MatrixSize {
  id: number | string
  label: string
}

export interface MatrixColour {
  id: number | string
  name: string
}

/** A (size, colour) pair that already has a row, so it must not be created twice. */
export interface ExistingCombination {
  size: number | string
  colour: number | string
}

export interface PlannedVariant {
  size: number | string
  colour: number | string
  sku: string
  sizeLabel: string
  colourName: string
}

export interface VariantMatrixPlan {
  /** Combinations to create, in size-major order so the admin list reads predictably. */
  create: PlannedVariant[]
  /** How many of the requested combinations already existed. */
  skipped: number
  /** Every cell the selection covers, whether new or not. */
  requested: number
}

function key(size: number | string, colour: number | string): string {
  return `${size}::${colour}`
}

/**
 * Plan the variants to create for `productTitle` across the selected sizes and colours.
 *
 * Idempotent with respect to `existing`: running the generator twice on the same selection
 * creates nothing the second time, which is what makes it safe to offer as a button an owner
 * can press again after adding one more colour.
 *
 * Throws if the selection is empty — an empty matrix is a mistake worth surfacing, not a
 * silent no-op that leaves the owner wondering whether the button worked.
 */
export function planVariantMatrix(
  productTitle: string,
  sizes: readonly MatrixSize[],
  colours: readonly MatrixColour[],
  existing: readonly ExistingCombination[] = [],
): VariantMatrixPlan {
  if (sizes.length === 0 || colours.length === 0) {
    throw new RangeError('Select at least one size and one colour to generate variants.')
  }

  const taken = new Set(existing.map((row) => key(row.size, row.colour)))

  const create: PlannedVariant[] = []
  let skipped = 0

  for (const size of sizes) {
    for (const colour of colours) {
      if (taken.has(key(size.id, colour.id))) {
        skipped += 1
        continue
      }

      create.push({
        size: size.id,
        colour: colour.id,
        sku: buildSku(productTitle, colour.name, size.label),
        sizeLabel: size.label,
        colourName: colour.name,
      })

      // Guards against a selection that lists the same size or colour twice.
      taken.add(key(size.id, colour.id))
    }
  }

  return { create, skipped, requested: sizes.length * colours.length }
}
