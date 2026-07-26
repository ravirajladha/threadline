import { config } from 'dotenv'

// Tests read the same local environment the dev server uses.
config({ path: '.env.local' })
config({ path: '.env' })
