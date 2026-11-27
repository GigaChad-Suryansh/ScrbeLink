/**
 * e2e/journey.spec.ts
 * Phase 19: Playwright end-to-end test for the ScribeLink landing -> upload -> legal pages flow.
 * Run in CI with Playwright installed against `npm run preview` + `npm run dev:api`.
 */

import { test, expect } from '@playwright/test'

test('landing page, calculator, legal footer links, and upload wizard load cleanly', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /written by hand/i })).toBeVisible()

  // Legal pages linked in footer
  for (const label of ['Terms of Service', 'Privacy (DPDP Act)', 'Refunds', 'Academic integrity', 'Contact']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible()
  }

  // Navigate to upload step
  await page.getByRole('link', { name: 'Place an order' }).first().click()
  await expect(page).toHaveURL(/\/order\/upload/)

  // Check legal page
  await page.goto('/legal/privacy')
  await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible()
})
