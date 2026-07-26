/**
 * Placeholder home page. Replaced by the real storefront in stage J3.
 * Exists so the foundation stage has a route to smoke-test.
 */
export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="text-fg-subtle text-sm tracking-[0.2em] uppercase">Threadline</p>
      <h1 className="text-fg text-5xl leading-tight font-medium">Clothing, considered.</h1>
      <p className="text-fg-muted max-w-prose text-lg">
        The storefront is being built stage by stage. This placeholder confirms the foundation is
        wired: Next.js, Payload, PostgreSQL and the design tokens.
      </p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {/* Deliberately a full page load: the admin is a separate Payload app,
            and client-side navigating into it would pull its bundle into the storefront. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/admin"
          className="bg-accent text-accent-fg hover:bg-accent-hover rounded-[--radius-control] px-5 py-2.5 text-sm font-medium transition-colors"
        >
          Open admin
        </a>
        <span className="text-fg-subtle text-sm">Stage J0 — Foundation</span>
      </div>
    </div>
  )
}
