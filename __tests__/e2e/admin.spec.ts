import { test, expect } from '@playwright/test';

const ADMIN_SECRET = 'f80554d8d6eeaba07f430eed835703d7';

test.describe('Admin Dashboard', () => {
  test('without secret redirects to landing page', async ({ page }) => {
    await page.goto('/admin');
    // AdminPage redirects to '/' when no secret is provided
    await page.waitForURL('**/', { timeout: 10000 });
    expect(page.url()).not.toContain('/admin');
  });

  test('with secret loads the admin dashboard', async ({ page }) => {
    await page.goto(`/admin?secret=${ADMIN_SECRET}`);
    await expect(page.locator('h1', { hasText: 'WhatsLater Admin' })).toBeVisible({ timeout: 15000 });
  });

  test('shows Sistema section with health checks', async ({ page }) => {
    await page.goto(`/admin?secret=${ADMIN_SECRET}`);
    await expect(page.locator('h2', { hasText: 'Sistema' })).toBeVisible({ timeout: 15000 });
  });

  test('shows Business & Clienti section', async ({ page }) => {
    await page.goto(`/admin?secret=${ADMIN_SECRET}`);
    await expect(page.locator('h2', { hasText: 'Business & Clienti' })).toBeVisible({ timeout: 15000 });
    // KPI cards
    await expect(page.getByText('Utenti totali')).toBeVisible();
    await expect(page.getByText('MRR')).toBeVisible();
  });

  test('shows Stripe section', async ({ page }) => {
    await page.goto(`/admin?secret=${ADMIN_SECRET}`);
    await expect(page.locator('h2', { hasText: 'Stripe' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Abbonamenti attivi')).toBeVisible();
    await expect(page.getByText('Revenue mese')).toBeVisible();
  });

  test('shows Alert Recenti section', async ({ page }) => {
    await page.goto(`/admin?secret=${ADMIN_SECRET}`);
    await expect(page.locator('h2', { hasText: 'Alert Recenti' })).toBeVisible({ timeout: 15000 });
  });

  test('chatbot input is visible', async ({ page }) => {
    await page.goto(`/admin?secret=${ADMIN_SECRET}`);
    await expect(page.locator('h2', { hasText: 'Sistema' })).toBeVisible({ timeout: 15000 });
    const chatInput = page.locator('input[placeholder*="Quanti messaggi"]');
    await expect(chatInput).toBeVisible();
    await expect(page.locator('button', { hasText: 'Chiedi' })).toBeVisible();
  });
});
