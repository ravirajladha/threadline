import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { collections } from './collections'
import { Users } from './collections/Users'
import { Settings } from './globals/Settings'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' · Threadline',
    },
    components: {
      // Counters an operator can act on, in place of a dashboard that only says hello.
      beforeDashboard: ['@/components/admin/DashboardCounters#DashboardCounters'],
    },
  },
  collections,
  globals: [Settings],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  sharp,
  // OWASP A05 (Security Misconfiguration) — never leak internals to API consumers in production.
  debug: process.env.NODE_ENV !== 'production',
  graphQL: {
    disablePlaygroundInProduction: true,
  },
})
