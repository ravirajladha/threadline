import type { Metadata } from 'next'
import React from 'react'

import '@/styles/globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Threadline',
    template: '%s · Threadline',
  },
  description: 'Clothing, considered.',
}

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-bg text-fg antialiased">
        <main>{children}</main>
      </body>
    </html>
  )
}
