/**
 * Inline icon set.
 *
 * The project ships no icon library, so this is the entire vocabulary the storefront draws
 * from. Every icon is a plain outline SVG on a 24×24 grid, sized by `font-size`/`className`
 * rather than fixed pixels, so it always sits correctly next to text.
 */

export interface IconProps {
  className?: string
}

const DEFAULT_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}

export function SearchIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

export function UserIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  )
}

export function BagIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  )
}

export function MenuIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function ChevronDownIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function ChevronLeftIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

export function ChevronRightIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function SunIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  )
}

export function MoonIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function MinusIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function FilterIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  )
}

/** Overlaid on a sold-out swatch or size pill. Never used to hide the option, only to mark it. */
export function DiagonalStrikeIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <line x1="4" y1="20" x2="20" y2="4" />
    </svg>
  )
}

export function PackageIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...DEFAULT_PROPS} className={className}>
      <path d="M3 7l9-4 9 4-9 4-9-4Z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  )
}
