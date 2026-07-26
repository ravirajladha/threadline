import type { SwatchView } from '@/lib/catalog/types'
import { DiagonalStrikeIcon } from './icons'

/**
 * A colour dot, used two ways: a read-only summary on a product card, and a real radio input
 * when a parent needs a selection (the colour row on a product page). The two modes share one
 * component so a card and a variant picker can never drift into different sold-out treatments.
 *
 * Selection is drawn as a ring rather than a border-width change, because swapping border
 * widths shifts every dot in the row by a pixel and that reads as jitter, not as feedback.
 */

const SIZE_CLASSES = {
  sm: 'size-6',
  md: 'size-8',
} as const

export interface SwatchProps {
  swatch: SwatchView
  selected?: boolean
  size?: keyof typeof SIZE_CLASSES
  /**
   * Presence turns this into a real radio input grouped by `name` — pass it when a parent owns
   * a selection (colour picker). Omit it for a static, read-only dot (a product card).
   */
  name?: string
  onSelect?: (colourId: number) => void
}

export function Swatch({
  swatch,
  selected = false,
  size = 'md',
  name,
  onSelect,
}: SwatchProps): React.ReactElement {
  const label = swatch.isAvailable ? swatch.name : `${swatch.name} (sold out)`
  const dimensionClass = SIZE_CLASSES[size]

  const dot = (
    <span
      className={`relative inline-flex ${dimensionClass} shrink-0 items-center justify-center rounded-full ring-offset-2 ring-offset-bg transition-shadow duration-fast ease-out ${
        selected ? 'ring-2 ring-accent' : 'ring-1 ring-border-strong'
      }`}
    >
      <span
        className="size-full rounded-full"
        style={{ backgroundColor: swatch.hex }}
        aria-hidden="true"
      />
      {!swatch.isAvailable ? (
        <DiagonalStrikeIcon className="text-fg absolute inset-0 size-full" />
      ) : null}
    </span>
  )

  if (name) {
    return (
      <label className="focus-within:outline-accent inline-flex cursor-pointer rounded-full focus-within:outline-2 focus-within:outline-offset-2">
        <input
          type="radio"
          name={name}
          value={swatch.id}
          checked={selected}
          aria-disabled={!swatch.isAvailable}
          aria-label={label}
          onChange={() => onSelect?.(swatch.id)}
          className="sr-only"
        />
        {dot}
      </label>
    )
  }

  return (
    <span role="img" aria-label={label} title={label}>
      {dot}
    </span>
  )
}
