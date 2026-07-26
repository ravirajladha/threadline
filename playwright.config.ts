import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

const baseURL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  /* Fail the build if a test.only was left in the source. */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    reuseExistingServer: !process.env.CI,
    url: baseURL,
    timeout: 180_000,
  },
})
