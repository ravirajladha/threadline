/**
 * Push the local `media/` folder into the configured object store.
 *
 * This exists because of a specific, easily-repeated trap. Media has two halves: a **row** in the
 * database and the **bytes** in storage. Before the S3 adapter was wired, uploads went to a local
 * folder — so seeding on a laptop wrote 32 rows that replicate through the shared database and 32
 * files that do not go anywhere. Deployed, `/api/media` lists every image happily while every
 * `/api/media/file/...` returns a 500, which reads as a broken app rather than a missing file.
 *
 * Re-running the seed does **not** fix that: `src/seed/index.ts` is idempotent by filename, so it
 * finds all 32 rows already present and uploads nothing. The rows are fine. It is only ever the
 * bytes that are missing, and this script moves exactly those.
 *
 * Run it with the S3 variables in your environment:
 *
 *     npm run media:sync
 *
 * Idempotent by design — an object already in the bucket is skipped, not re-uploaded, so running
 * it twice costs two HEAD requests per file and nothing else. Safe to run any time you are unsure
 * whether storage and the database agree.
 *
 * It never deletes. A file in the bucket with no local counterpart is left alone: this is a
 * one-way sync, because the bucket is the durable copy and the local folder is a build artefact.
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import dotenv from 'dotenv'

// The same file Next and Payload read, so the script cannot be configured differently from the
// app it is filling the bucket for.
dotenv.config({ path: '.env.local' })

const MEDIA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'media')

/**
 * Content types, by extension.
 *
 * Set explicitly rather than left to the SDK, which defaults to `application/octet-stream`. A
 * WebP served as a binary blob makes browsers download it instead of rendering it, and Next's
 * image optimiser rejects it outright with a 400 — the exact symptom this script exists to cure,
 * reintroduced one layer further down.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
}

interface StorageConfig {
  bucket: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/** Read the configuration, or explain precisely what is missing. Never prints a secret. */
function readConfig(): StorageConfig {
  const required = {
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  }

  const missing = Object.entries(required)
    .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new Error(
      `Object storage is not configured. Missing: ${missing.join(', ')}.\n` +
        'Add them to .env.local (the same values you set in Railway). This script only reads ' +
        'them; it never prints or logs their contents.',
    )
  }

  return {
    bucket: required.S3_BUCKET!.trim(),
    endpoint: required.S3_ENDPOINT!.trim(),
    region: (process.env.S3_REGION ?? 'auto').trim(),
    accessKeyId: required.S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: required.S3_SECRET_ACCESS_KEY!.trim(),
  }
}

/** Whether the object is already there. Any error other than "not found" is worth surfacing. */
async function objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode

    if (status === 404) return false

    // 403 usually means the token lacks read permission — worth saying so, because the upload
    // that follows would otherwise fail with a less obvious message.
    throw error
  }
}

async function main(): Promise<void> {
  const config = readConfig()

  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 addresses buckets as `endpoint/bucket` rather than by virtual host. Matches the adapter.
    forcePathStyle: true,
  })

  let files: string[]
  try {
    files = (await readdir(MEDIA_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  } catch {
    console.error(`No local media folder at ${MEDIA_DIR}. Nothing to sync.`)
    process.exit(1)
  }

  if (files.length === 0) {
    console.log(`No files in ${MEDIA_DIR}. Nothing to sync.`)
    return
  }

  console.log(`Syncing ${files.length} file(s) to ${config.bucket} at ${config.endpoint}\n`)

  let uploaded = 0
  let skipped = 0
  const failures: Array<{ file: string; reason: string }> = []

  for (const file of files) {
    // The object key is the bare filename: the Payload adapter is configured with no prefix, so
    // this is exactly what `/api/media/file/<filename>` will ask the bucket for.
    const key = file
    const extension = path.extname(file).toLowerCase()
    const contentType = CONTENT_TYPES[extension]

    if (contentType === undefined) {
      failures.push({ file, reason: `unsupported extension "${extension}"` })
      continue
    }

    try {
      if (await objectExists(client, config.bucket, key)) {
        skipped += 1
        console.log(`  = ${file} (already present)`)
        continue
      }

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: await readFile(path.join(MEDIA_DIR, file)),
          ContentType: contentType,
        }),
      )

      uploaded += 1
      console.log(`  + ${file}`)
    } catch (error) {
      failures.push({ file, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  console.log(`\nUploaded ${uploaded}, already present ${skipped}, failed ${failures.length}.`)

  if (failures.length > 0) {
    console.error('\nFailures:')
    for (const failure of failures) console.error(`  ! ${failure.file}: ${failure.reason}`)
    // A non-zero exit so this is noticed when it is ever run from a deploy step rather than by hand.
    process.exit(1)
  }
}

await main()
