/**
 * The "nothing here" state — no results for a filter set, an empty wishlist, a search with no
 * matches. One shape for all of them so the storefront never shows a bare blank page, which
 * reads as broken rather than as an empty state.
 */

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): React.ReactElement {
  return (
    <div role="status" className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      {icon ? (
        <div className="text-fg-subtle" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h2 className="text-fg text-lg font-medium">{title}</h2>
        {description ? <p className="text-fg-muted max-w-prose text-sm">{description}</p> : null}
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}
