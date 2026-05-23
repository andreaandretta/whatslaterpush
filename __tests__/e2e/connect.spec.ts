import { test, expect } from '@playwright/test';

test.describe('/connect page', () => {
  test('shows phone input with new placeholder on first load', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText(/Connetti|Collega/i).first()).toBeVisible();
    await expect(page.getByPlaceholder('3331234567')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mostra il QR' })).toBeVisible();
  });

  test('has WhatsLater branding (navbar)', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText('WhatsLater').first()).toBeVisible();
  });

  test('shows trust cues in footer on input phase', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText(/2 min/i)).toBeVisible();
    await expect(page.getByText(/Cifrato/i)).toBeVisible();
    await expect(page.getByText(/No carta/i)).toBeVisible();
  });

  test('shows 3-step stepper', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByRole('navigation', { name: /Progresso connessione/i })).toBeVisible();
    await expect(page.getByText(/1\s*·\s*Numero/i)).toBeVisible();
    await expect(page.getByText(/2\s*·\s*QR/i)).toBeVisible();
    await expect(page.getByText(/3\s*·\s*Dashboard/i)).toBeVisible();
  });

  test('shows error phase on invalid phone', async ({ page }) => {
    await page.goto('/connect');
    await page.getByPlaceholder('3331234567').fill('abc');
    await page.getByRole('button', { name: 'Mostra il QR' }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'Riprova' })).toBeVisible();
  });
});

test.describe('/dashboard page (cookie required)', () => {
  test('redirects away when no cookie', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });
});
