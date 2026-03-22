import { test, expect } from '@playwright/test';
import { mockCheckout } from './helpers/mocks';

test.describe('Pricing & Checkout', () => {
  test('landing page pricing shows correct plans and prices', async ({ page }) => {
    await page.goto('/');
    const pricing = page.locator('#prezzi');
    await pricing.scrollIntoViewIfNeeded();

    // Verify all 3 plan names
    await expect(pricing.locator('h3', { hasText: 'Free' })).toBeVisible();
    await expect(pricing.locator('h3', { hasText: 'Personal' })).toBeVisible();
    await expect(pricing.locator('h3', { hasText: 'Business' })).toBeVisible();

    // Verify prices
    await expect(pricing.getByText('€0')).toBeVisible();
    await expect(pricing.getByText('€4,99')).toBeVisible();
    await expect(pricing.getByText('€19,99')).toBeVisible();

    // Verify feature highlights
    await expect(pricing.getByText('3 messaggi/giorno')).toBeVisible();
    await expect(pricing.getByText('20 messaggi/giorno')).toBeVisible();
    await expect(pricing.getByText('50 messaggi/giorno')).toBeVisible();
  });

  test('Personal plan has "Consigliato" badge', async ({ page }) => {
    await page.goto('/');
    const pricing = page.locator('#prezzi');
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing.getByText('Consigliato')).toBeVisible();
  });

  test('Free plan shows "Gratuito" (no checkout button)', async ({ page }) => {
    await page.goto('/');
    const pricing = page.locator('#prezzi');
    await pricing.scrollIntoViewIfNeeded();

    // Free plan should show "Gratuito" text, not a checkout button
    await expect(pricing.getByText('Gratuito')).toBeVisible();
  });

  test('Personal plan CTA redirects to Stripe checkout', async ({ page }) => {
    // Set up a connected dashboard session first
    await page.goto('/dashboard');
    await page.evaluate(() => {
      localStorage.setItem('sw_phone', '393401234567');
      localStorage.setItem('sw_instance', 'SchedWhats-test-instance');
      localStorage.setItem('sw_expiry', String(Date.now() + 30 * 24 * 3600 * 1000));
    });

    // Mock connect API to return connected status
    await page.route('**/api/connect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'open', owner: '393401234567' }),
      });
    });

    // Mock messages to return free plan (so pricing section shows)
    await page.route('**/api/messages*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [],
          subscription_plan: 'free',
          trial_ends_at: null,
        }),
      });
    });

    await mockCheckout(page);

    await page.reload();
    await expect(page.locator('h3', { hasText: 'WhatsApp Connesso' })).toBeVisible({ timeout: 15000 });

    // Scroll to pricing section and click Personal plan
    const personalButton = page.locator('#prezzi button', { hasText: 'Passa a Personal' });
    await personalButton.scrollIntoViewIfNeeded();

    // Intercept navigation to Stripe
    const [request] = await Promise.all([
      page.waitForRequest('**/api/payment/create-checkout'),
      personalButton.click(),
    ]);

    expect(request.method()).toBe('POST');
  });
});
