'use client'
// Interactive: owns colour, size and quantity selection ahead of a J4 cart to add them to.

import { useEffect, useId, useState } from 'react'
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

  const [selectedSizeId, setSelectedSizeId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [sizeChartOpen, setSizeChartOpen] = useState(false)

  // A colour change hands back a fresh set of pills for the new colour — pick a sensible
  // default from it rather than carrying over a size id that may not exist in this colour.
  const pillsSignature = sizePills.map((pill) => pill.sizeId).join(',')
  useEffect(() => {
    const firstAvailable = sizePills.find((pill) => pill.isAvailable)
    setSelectedSizeId(firstAvailable?.sizeId ?? sizePills[0]?.sizeId ?? null)
    setQuantity(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the pill set, not the array reference.
  }, [pillsSignature])

  const selectedPill = sizePills.find((pill) => pill.sizeId === selectedSizeId) ?? null
  const isSoldOutPick = selectedPill !== null && (!selectedPill.isAvailable || selectedPill.variantId === null)
  const maxQuantity = selectedPill && selectedPill.isAvailable ? Math.max(1, selectedPill.availableQty) : 1

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
                    onChange={() => setSelectedSizeId(pill.sizeId)}
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
              onClick={() => setQuantity((qty) => Math.max(1, qty - 1))}
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
                  setQuantity(Math.min(maxQuantity, Math.max(1, Math.round(parsed))))
                }
              }}
              className="text-fg w-12 border-0 bg-transparent text-center text-sm"
            />
            <button
              type="button"
              onClick={() => setQuantity((qty) => Math.min(maxQuantity, qty + 1))}
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
