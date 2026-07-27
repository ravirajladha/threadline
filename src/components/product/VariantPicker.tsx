'use client'
// Interactive: owns colour, size and quantity selection ahead of a J4 cart to add them to.

import { useId, useState } from 'react'
import type { ProductDetailView, SizePillView } from '@/lib/catalog/types'
import { Swatch } from '../ui/Swatch'
import { MinusIcon, PlusIcon } from '../ui/icons'
import { SizeChartModal } from './SizeChartModal'

/**
 * Colour swatches, size pills, a quantity stepper and the buy button — the one interactive
 * cluster a product page exists to lead a customer to.
 *
 * Colour selection is controlled from outside: the page also has to re-filter the gallery when
 * it changes, so `VariantPicker` reports the choice via `onColourChange` rather than owning a
 * fact the gallery needs too. Size and quantity stay local — nothing else on the page depends
 * on them yet. `sizes` is passed in already scoped to the selected colour (`sizePillsFor`), so
 * this component never has to re-derive availability from the raw variant list itself.
 */

export interface VariantPickerProps {
  product: ProductDetailView
  selectedColourId: number | null
  onColourChange: (colourId: number) => void
  /** Size pills for the currently selected colour. */
  sizes: SizePillView[]
}

export function VariantPicker({
  product,
  selectedColourId,
  onColourChange,
  sizes: sizePills,
}: VariantPickerProps): React.ReactElement {
  const { swatches, sizeChart } = product
  const colourGroupName = useId()
  const sizeGroupName = useId()

  // Only what the customer actually chose is stored. A colour change hands back a fresh set of
  // pills, and a size the previous colour offered may not exist in the new one — but that is a
  // question the render already has the answer to, so resolving it here rather than
  // resynchronising state in an effect avoids a second render on every swatch click.
  const [chosenSizeId, setChosenSizeId] = useState<number | null>(null)
  const [chosenQuantity, setChosenQuantity] = useState(1)
  const [sizeChartOpen, setSizeChartOpen] = useState(false)

  // The effective selection: the customer's own pick while it is still on offer, otherwise the
  // first size that can actually be bought, otherwise the first pill — a sold-out one is a valid
  // landing place, since it is what turns the CTA into "Notify me" rather than a dead end.
  const chosenPill = sizePills.find((pill) => pill.sizeId === chosenSizeId) ?? null
  const selectedPill = chosenPill ?? sizePills.find((pill) => pill.isAvailable) ?? sizePills[0] ?? null
  const selectedSizeId = selectedPill?.sizeId ?? null

  const isSoldOutPick = selectedPill !== null && (!selectedPill.isAvailable || selectedPill.variantId === null)
  const maxQuantity = selectedPill && selectedPill.isAvailable ? Math.max(1, selectedPill.availableQty) : 1
  // Clamped rather than reset, for the same reason: switching to a colour with two left in this
  // size must not leave a five in the box, and clamping expresses that without an effect.
  const quantity = Math.min(chosenQuantity, maxQuantity)

  return (
    <div className="flex flex-col gap-6">
      {swatches.length > 0 ? (
        <div>
          <p className="text-fg mb-2 text-sm font-medium">Colour</p>
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
            {swatches.map((swatch) => (
              <Swatch
                key={swatch.id}
                swatch={swatch}
                name={colourGroupName}
                selected={swatch.id === selectedColourId}
                onSelect={onColourChange}
              />
            ))}
          </div>
        </div>
      ) : null}

      {sizePills.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-fg text-sm font-medium">Size</p>
            {sizeChart ? (
              <button
                type="button"
                onClick={() => setSizeChartOpen(true)}
                className="text-accent text-sm underline-offset-2 hover:underline"
              >
                Size guide
              </button>
            ) : null}
          </div>
          <div role="radiogroup" aria-label="Size" className="flex flex-wrap gap-2">
            {sizePills.map((pill) => {
              const unavailable = !pill.isAvailable || pill.variantId === null
              const checked = pill.sizeId === selectedSizeId
              return (
                <label
                  key={pill.sizeId}
                  className="focus-within:outline-accent inline-flex cursor-pointer rounded-[--radius-control] focus-within:outline-2 focus-within:outline-offset-2"
                >
                  <input
                    type="radio"
                    name={sizeGroupName}
                    value={pill.sizeId}
                    checked={checked}
                    aria-disabled={unavailable}
                    onChange={() => setChosenSizeId(pill.sizeId)}
                    className="sr-only"
                  />
                  <span
                    className={`rounded-[--radius-control] border px-4 py-2 text-sm transition-colors duration-fast ease-out ${
                      checked ? 'border-accent bg-accent-subtle text-fg' : 'border-border-strong text-fg'
                    } ${unavailable ? 'text-fg-subtle line-through' : ''}`}
                  >
                    {pill.label}
                    {unavailable ? <span className="sr-only"> (sold out)</span> : null}
                  </span>
                </label>
              )
            })}
          </div>
          {selectedPill?.isLow && !isSoldOutPick ? (
            <p className="text-warning mt-2 text-sm">Only {selectedPill.availableQty} left</p>
          ) : null}
        </div>
      ) : null}

      {!isSoldOutPick ? (
        <div>
          <p className="text-fg mb-2 text-sm font-medium">Quantity</p>
          <div className="border-border-strong inline-flex items-center rounded-[--radius-control] border">
            <button
              type="button"
              onClick={() => setChosenQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
              className="text-fg p-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MinusIcon className="size-4" />
            </button>
            <input
              type="number"
              min={1}
              max={maxQuantity}
              value={quantity}
              aria-label="Quantity"
              onChange={(event) => {
                const parsed = Number(event.target.value)
                if (Number.isFinite(parsed)) {
                  setChosenQuantity(Math.min(maxQuantity, Math.max(1, Math.round(parsed))))
                }
              }}
              className="text-fg w-12 border-0 bg-transparent text-center text-sm"
            />
            <button
              type="button"
              onClick={() => setChosenQuantity(Math.min(maxQuantity, quantity + 1))}
              disabled={quantity >= maxQuantity}
              aria-label="Increase quantity"
              className="text-fg p-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        disabled
        className="bg-accent text-accent-fg rounded-[--radius-control] px-6 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSoldOutPick ? 'Notify me' : 'Coming in J4'}
      </button>

      <SizeChartModal chart={sizeChart} open={sizeChartOpen} onClose={() => setSizeChartOpen(false)} />
    </div>
  )
}
