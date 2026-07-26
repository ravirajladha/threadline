/**
 * A loading placeholder. `animate-pulse` is a plain Tailwind utility, not a bespoke keyframe,
 * so the global `prefers-reduced-motion` rule in `globals.css` already neutralises it — nothing
 * extra is needed here to respect that setting.
 */

export interface SkeletonProps {
  className?: string
  /** Escape hatch for geometry that isn't a token — e.g. matching an image's aspect ratio. */
  style?: React.CSSProperties
}

export function Skeleton({ className = '', style }: SkeletonProps): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={`bg-surface-raised animate-pulse rounded-[--radius-control] ${className}`}
    />
  )
}
