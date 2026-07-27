'use client'
// Interactive: flips the explicit theme choice, persists it, and reflects the active theme in
// the icon it shows.

import { useSyncExternalStore } from 'react'
import { MoonIcon, SunIcon } from '../ui/icons'

const STORAGE_KEY = 'theme'
type StoredTheme = 'light' | 'dark'

/** Matches the `:root` block in `tokens.css`. The storefront opens light regardless of the OS. */
const DEFAULT_THEME: StoredTheme = 'light'

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

  // No stored choice means light, because `tokens.css` no longer carries a
  // `prefers-color-scheme` block — the OS does not select the theme. Reading `matchMedia` here
  // instead would make the icon disagree with the page it sits on for every visitor running a
  // dark desktop, and their first click would appear to do nothing.
  return DEFAULT_THEME
}

/** The server has no DOM to read, and renders the same default the client resolves to. */
function readServerTheme(): StoredTheme {
  return DEFAULT_THEME
}

const listeners = new Set<() => void>()

/** Notifies subscribers of a change React cannot observe — our own toggle, or another tab. */
function emitThemeChange(): void {
  for (const listener of listeners) listener()
}

/**
 * `storage` is the only external source left. It fires when *another tab* changes the choice,
 * which is what keeps two open tabs of the shop agreed on the theme. There is no longer a
 * `matchMedia` subscription: the OS preference does not select the theme, so an OS switch is not
 * a change this component needs to observe.
 */
function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', emitThemeChange)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', emitThemeChange)
  }
}

/** A light/dark toggle. Light until the visitor chooses otherwise; the choice then persists. */
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
