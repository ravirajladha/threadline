'use client'
// Interactive: flips the explicit theme choice, persists it, and reflects the active theme in
// the icon it shows.

import { useEffect, useState } from 'react'
import { MoonIcon, SunIcon } from '../ui/icons'

const STORAGE_KEY = 'theme'
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
  // eslint-disable-next-line react/no-danger -- static script, no user input, see comment above.
  return <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
}

function readActiveTheme(): StoredTheme {
  if (typeof document === 'undefined') return 'light'
  const explicit = document.documentElement.getAttribute('data-theme')
  if (isStoredTheme(explicit)) return explicit
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/** A light/dark toggle. With no explicit choice yet, it follows the OS until the user picks. */
export function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = useState<StoredTheme>('light')

  useEffect(() => {
    setTheme(readActiveTheme())
  }, [])

  const toggle = (): void => {
    const next: StoredTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private-browsing storage denial should not break the toggle itself.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="text-fg-muted hover:text-fg hover:bg-surface-raised rounded-[--radius-control] p-2 transition-colors duration-fast ease-out"
    >
      {theme === 'dark' ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
    </button>
  )
}
