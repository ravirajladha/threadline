import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig, type Plugin } from 'payload'
import sharp from 'sharp'

import { collections } from './collections'
import { Users } from './collections/Users'
import { Settings } from './globals/Settings'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * Object storage for uploads.
 *
 * CLAUDE.md §1 specifies S3-compatible storage "never local disk", and this is where that becomes
 * true. Without it Payload writes uploads to a `media/` folder beside the code — which works
 * perfectly on a laptop and fails silently the moment the app is deployed: the *rows* replicate
 * through the database while the *bytes* stay on whichever machine did the upload. The symptom is
 * a catalog whose images all 500 while `/api/media` cheerfully lists every file.
 *
 * Cloudflare R2 speaks the S3 API, so the same adapter serves both it and AWS. R2 needs
 * `forcePathStyle` because it addresses buckets as `endpoint/bucket` rather than by virtual host.
 *
 * Payload's own access control stays in front of the files — `disablePayloadAccessControl` is
 * deliberately not set — so media is served through `/api/media/file/...` and the bucket itself
 * never has to be public. A public bucket is an enumerable, unmetered copy of the catalog.
 */
function storagePlugins(): Plugin[] {
  const bucket = process.env.S3_BUCKET
  const endpoint = process.env.S3_ENDPOINT
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

  const configured =
    typeof bucket === 'string' &&
    bucket.length > 0 &&
    typeof endpoint === 'string' &&
    endpoint.length > 0 &&
    typeof accessKeyId === 'string' &&
    accessKeyId.length > 0 &&
    typeof secretAccessKey === 'string' &&
    secretAccessKey.length > 0

  if (!configured) {
    // The same rule the payment factory follows: a development convenience must be impossible to
    // reach in production. Falling back to local disk on a deployed server is precisely the
    // failure this plugin exists to prevent, so it is a refusal to boot rather than a warning
    // nobody reads.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Object storage is not configured. Set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and ' +
          'S3_SECRET_ACCESS_KEY. Uploads must never be written to local disk in production — the ' +
          'files do not survive a redeploy and every image 500s while its database row looks fine.',
      )
    }

    return []
  }

  return [
    s3Storage({
      collections: { media: true },
      bucket,
      config: {
        endpoint,
        // R2 ignores regions but the S3 client requires one; `auto` is Cloudflare's own answer.
        region: process.env.S3_REGION ?? 'auto',
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      },
    }),
  ]
}

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
  plugins: storagePlugins(),
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
