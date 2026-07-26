/**
 * Loads the local environment before anything else in the seed process.
 *
 * Its own module on purpose: ESM evaluates imports before any statement in the importing file
 * runs, so `payload.config.ts` would read `PAYLOAD_SECRET` and `DATABASE_URI` from an empty
 * `process.env` if this were a `loadEnv()` call at the top of `index.ts`. Importing this first
 * is what guarantees the ordering.
 */
import { config as loadEnv } from 'dotenv'

// `.env.local` wins over `.env` — the same order the dev server and the test setup use.
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })
