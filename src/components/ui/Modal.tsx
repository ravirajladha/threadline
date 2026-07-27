'use client'
// Interactive: owns open/close of a native <dialog>, traps focus inside it, closes on Escape
// or an outside click, and restores focus to whatever triggered it.

import { useEffect, useId, useRef } from 'react'
import { CloseIcon } from './icons'

/**
 * The one modal primitive in the system — the mobile filter sheet and the size chart both sit
 * on top of it rather than each rolling its own focus-trap logic.
 *
 * Built on `<dialog>` deliberately: `showModal()` puts it in the top layer, makes the rest of
 * the page inert for free, and gives Escape-to-close without any key handling here at all. What
 * is left to wire by hand is body-scroll locking, closing on a backdrop click, and restoring
 * focus to the element that opened it.
 */

/**
 * Centred with rounded corners by default. Passing `className` replaces this outright rather
 * than competing with it for the same properties — a bottom sheet or a side drawer sets its own
 * size, position and corners in one string instead of fighting a default for the same box.
 */
const DEFAULT_BOX_CLASSES = 'm-auto w-full max-w-lg rounded-card'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** Size, position and corners of the `<dialog>` box. Replaces the centred default entirely. */
  className?: string
  /**
   * A viewport-height cap, as a percentage. Not a Tailwind class — the design tokens have no
   * viewport-relative unit, so this is the one piece of geometry set as an inline style. Set to
   * 100 for a full-height drawer.
   */
  maxHeightVh?: number
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className = DEFAULT_BOX_CLASSES,
  maxHeightVh = 85,
}: ModalProps): React.ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const headingId = useId()

  // Open and close the native dialog to match the `open` prop, and lock page scroll while
  // it is up — `showModal()` alone does not reliably stop the page behind it from scrolling.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      triggerRef.current = document.activeElement
      if (!dialog.open) dialog.showModal()
      document.body.style.overflow = 'hidden'
    } else {
      if (dialog.open) dialog.close()
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // The dialog's own `close` event fires for Escape, `.close()` calls and the backdrop-click
  // handler below alike, so restoring focus and telling the parent to update state both happen
  // from a single listener rather than being duplicated at every place a close can start.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleClose = () => {
      onClose()
      const trigger = triggerRef.current
      if (trigger instanceof HTMLElement) trigger.focus()
    }

    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [onClose])

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>): void => {
    // A click on the dialog element itself (rather than something inside it) landed on the
    // backdrop, since the dialog's box only covers its rendered content.
    if (event.target === dialogRef.current) {
      dialogRef.current?.close()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onClick={handleBackdropClick}
      onCancel={(event) => {
        // Let the native Escape handling proceed; `close` (above) does the actual cleanup.
        event.currentTarget.close()
      }}
      style={{ maxHeight: `${maxHeightVh}vh` }}
      className={`bg-surface text-fg overflow-y-auto border-0 p-0 shadow-lg backdrop:bg-fg/30 ${className}`}
    >
      <div className="border-border flex items-center justify-between gap-4 border-b p-4">
        <h2 id={headingId} className="text-fg text-base font-medium">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
          className="text-fg-muted hover:text-fg hover:bg-surface-raised rounded-control p-1.5 transition-colors duration-fast ease-out"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  )
}
