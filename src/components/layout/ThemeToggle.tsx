'use client'
// Interactive: flips the explicit theme choice, persists it, and reflects the active theme in
// the icon it shows.

import { useSyncExternalStore } from 'react'
import { MoonIcon, SunIcon } from '../ui/icons'

const STORAGE_KEY = 'theme'
const PREFERS_DARK = '(prefers-color-scheme: dark)'
type StoredTheme = 'light' | 'dark'

function isStoredTheme(value: string | null): value is StoredTheme {
  return value === 'light' || value === 'dark'
}

/**
 * The inline script that runs before React hydrates and before first paint. Reading
 * `localStorage` here — rather than waiting for `ThemeToggle` to mount — is what stops a
 * dark-mode visitor seeing a flash of the light theme while the page loads.
 *
 * The script body is a static string with no interpolated data, so `dangerouslySetInnerHTML`
 * carries no injection risk here — there is nothing in it that came from a user or a request.
 */
const NO_FLASH_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`

export function ThemeScript(): React.ReactElement {
  return <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
}

/**
 * The active theme lives in the DOM and in `localStorage`, not in React — `NO_FLASH_SCRIPT` has
 * already set it before this component exists. So it is read as an external store rather than
 * copied into state on mount: `useSyncExternalStore` is the hook built for exactly that, it
 * gives the server a defined snapshot instead of a hydration mismatch, and it removes the
 * mount-time `setState` that a plain effect would need.
 */
function readActiveTheme(): StoredTheme {
  const explicit = document.documentElement.getAttribute('data-theme')
  if (isStoredTheme(explicit)) return explicit
  return window.matchMedia(PREFERS_DARK).matches ? 'dark' : 'light'
}

/** The server has no DOM and no OS preference to read, so it renders the default. */
function readServerTheme(): StoredTheme {
  return 'light'
}

const listeners = new Set<() => void>()

/** Notifies subscribers of a change React cannot observe — our own toggle, or another tab. */
function emitThemeChange(): void {
  for (const listener of listeners) listener()
}

function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  const media = window.matchMedia(PREFERS_DARK)
  // The OS preference matters only while no explicit choice is stored, but subscribing
  // unconditionally is what makes the icon follow a system switch in that state.
  media.addEventListener('change', emitThemeChange)
  window.addEventListener('storage', emitThemeChange)

  return () => {
    listeners.delete(listener)
    media.removeEventListener('change', emitThemeChange)
    window.removeEventListener('storage', emitThemeChange)
  }
}

/** A light/dark toggle. With no explicit choice yet, it follows the OS until the user picks. */
export function ThemeToggle(): React.ReactElement {
  const theme = useSyncExternalStore(subscribeToTheme, readActiveTheme, readServerTheme)

  const toggle = (): void => {
    const next: StoredTheme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private-browsing storage denial should not break the toggle itself.
    }
    emitThemeChange()
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="text-fg-muted hover:text-fg hover:bg-surface-raised rounded-control p-2 transition-colors duration-fast ease-out"
    >
      {theme === 'dark' ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
    </button>
  )
}
