import { test, expect } from '@playwright/test';

test.describe('/connect page', () => {
  test('shows phone input on first load', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText(/Connetti WhatsApp/i)).toBeVisible();
    await expect(page.getByPlaceholder(/393331234567/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Procedi/i })).toBeVisible();
  });

  test('shows error on invalid phone', async ({ page }) => {
    await page.goto('/connect');
    await page.getByPlaceholder(/393331234567/).fill('abc');
    await page.getByRole('button', { name: /Procedi/i }).click();
    // Server returns 400 with error message — UI shows it
    await expect(page.getByText(/numero|formato|valido/i)).toBeVisible({ timeout: 8000 });
  });
});

test.describe('/dashboard page (cookie required)', () => {
  test('redirects away when no cookie', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard');
    // Middleware should redirect away from /dashboard (to /)
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });
});
