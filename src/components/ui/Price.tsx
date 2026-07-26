/**
 * Renders a paise amount as a rupee figure.
 *
 * Money stays an integer number of paise everywhere in the system until it reaches this
 * boundary — see CLAUDE.md §2 "Money is integer paise." This is the one place that is allowed
 * to divide by 100, and it exists so that division never happens twice, in two different
 * roundings, in two different components.
 */

const FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

function formatPaise(pricePaise: number): string {
  return FORMATTER.format(pricePaise / 100)
}

const SIZE_CLASSES = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
} as const

export interface PriceProps {
  pricePaise: number
  /** Shown struck through and muted, only when it is genuinely higher than `pricePaise`. */
  compareAtPricePaise?: number | null
  size?: keyof typeof SIZE_CLASSES
}

export function Price({
  pricePaise,
  compareAtPricePaise = null,
  size = 'md',
}: PriceProps): React.ReactElement {
  return (
    <span className={`inline-flex items-baseline gap-2 ${SIZE_CLASSES[size]}`}>
      <span className="text-fg font-medium">{formatPaise(pricePaise)}</span>
      {compareAtPricePaise !== null && compareAtPricePaise > pricePaise ? (
        <span className="text-fg-subtle text-sm line-through">{formatPaise(compareAtPricePaise)}</span>
      ) : null}
    </span>
  )
}
