/**
 * The client bundle must not reach the server's runtime.
 *
 * This test exists because of a real outage. `SignInForm.tsx` imported `OTP_LENGTH` from
 * `lib/auth/otp`, which imports `payments/signature`, which imports `node:crypto`. Webpack cannot
 * bundle a Node built-in for the browser, so `next build` failed outright — and because `next dev`
 * compiles per route and tolerates it, the whole of J8 was written, committed and pushed against a
 * tree that could not be deployed. Production silently stayed on the previous build for a full
 * stage while every local signal was green.
 *
 * `npm run check` could not have caught it: TypeScript resolves the module fine and has no concept
 * of which runtime it targets, and lint has no view of the graph. So the graph is walked here.
 *
 * The same walk catches `@payload-config`, which is the other thing that must never cross into a
 * client component — importing it drags every collection, the database adapter and sharp into the
 * browser bundle. It is also the shape of the circular import J8 hit from the other direction.
 */
import fs from 'fs'
import path from 'path'

import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '../../src')

/** Modules that only exist on the server. `node:` covers the prefixed form of all of them. */
const SERVER_ONLY = new Set(['fs', 'path', 'crypto', 'os', 'child_process', 'net', 'tls', 'http', 'https'])

function isServerOnly(spec: string): boolean {
  return spec.startsWith('node:') || SERVER_ONLY.has(spec) || spec === '@payload-config'
}

function resolveModule(spec: string, fromFile: string): string | null {
  // Only first-party modules are walked. A package that mis-declares its own environment is the
  // bundler's problem to report, and node_modules is far too large to crawl on every test run.
  if (!spec.startsWith('@/') && !spec.startsWith('.')) return null

  const base = spec.startsWith('@/')
    ? path.join(SRC, spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec)

  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    // Payload's generated files import with an explicit `.js` extension that resolves to `.ts`.
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
  ]

  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null
}

/**
 * Value imports only. `import type` is erased before a bundler ever sees it, so a type pulled from
 * a server module is harmless — and forbidding it would push the codebase into duplicating types.
 */
function valueImports(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
  const found: string[] = []

  for (const match of source.matchAll(/(?:^|\n)([^\n]*\bimport\b[^\n]*from\s*['"]([^'"]+)['"])/g)) {
    if (/\bimport\s+type\s/.test(match[1])) continue
    found.push(match[2])
  }

  return found
}

function walkDir(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkDir(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const clientComponents = walkDir(SRC).filter((f) => fs.readFileSync(f, 'utf8').startsWith("'use client'"))

/** The chain from a client component to a server-only module, or `null` if there is none. */
function findServerImportChain(entry: string): string[] | null {
  const seen = new Set<string>()
  const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }]

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)

    for (const spec of valueImports(file)) {
      if (isServerOnly(spec)) return [...chain, spec].map((s) => (s === spec ? s : path.relative(SRC, s)))

      const resolved = resolveModule(spec, file)
      if (resolved !== null) queue.push({ file: resolved, chain: [...chain, resolved] })
    }
  }

  return null
}

describe('client/server module boundary', () => {
  it('finds the client components to check', () => {
    // A regex that silently stops matching would turn this whole file into a no-op that always
    // passes, which is worse than not having it.
    expect(clientComponents.length).toBeGreaterThan(20)
  })

  it.each(clientComponents.map((f) => [path.relative(SRC, f), f]))(
    '%s does not reach a server-only module',
    (_label, entry) => {
      const chain = findServerImportChain(entry)

      expect(
        chain,
        chain === null ? '' : `server-only import reached through:\n  ${chain.join('\n  → ')}`,
      ).toBeNull()
    },
  )
})
