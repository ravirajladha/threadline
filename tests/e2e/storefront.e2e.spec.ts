import { expect, test } from '@playwright/test'

test.describe('Storefront', () => {
  test('home page renders', async ({ page }) => {
    const response = await page.goto('/')

    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Threadline/)
    await expect(page.locator('h1').first()).toBeVisible()
  })

  test('admin panel is reachable', async ({ page }) => {
    const response = await page.goto('/admin')

    expect(response?.status()).toBe(200)
  })
})
