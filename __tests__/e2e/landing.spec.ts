import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('loads successfully', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
  });

  test('navbar shows WhatsLater logo', async ({ page }) => {
    await page.goto('/');
    const logo = page.locator('nav a', { hasText: 'WhatsLater' });
    await expect(logo).toBeVisible();
  });

  test('hero CTA button is visible', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('a', { hasText: 'Provalo gratis' });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/connect');
  });

  test('pricing section shows 3 plans', async ({ page }) => {
    await page.goto('/');
    const pricingSection = page.locator('#prezzi');
    await expect(pricingSection).toBeVisible();

    await expect(pricingSection.locator('h3', { hasText: 'Free' })).toBeVisible();
    await expect(pricingSection.locator('h3', { hasText: 'Personal' })).toBeVisible();
    await expect(pricingSection.locator('h3', { hasText: 'Business' })).toBeVisible();

    // Check prices
    await expect(pricingSection.getByText('€0')).toBeVisible();
    await expect(pricingSection.getByText('€4,99')).toBeVisible();
    await expect(pricingSection.getByText('€19,99')).toBeVisible();
  });

  test('FAQ accordion opens and closes', async ({ page }) => {
    await page.goto('/');
    const faqSection = page.locator('#faq');
    await faqSection.scrollIntoViewIfNeeded();

    // First FAQ is open by default
    const firstAnswer = faqSection.locator('p', { hasText: 'I tuoi dati sono protetti' });
    await expect(firstAnswer).toBeVisible();

    // Click second FAQ question
    const secondQuestion = faqSection.locator('button', { hasText: 'Come collego WhatsApp?' });
    await secondQuestion.click();

    // Second answer should now be visible
    const secondAnswer = faqSection.locator('p', { hasText: 'Inserisci il tuo numero di telefono' });
    await expect(secondAnswer).toBeVisible();
  });

  test('footer has Privacy and Terms links', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer.locator('a', { hasText: /privacy/i })).toBeVisible();
    await expect(footer.locator('a', { hasText: /terms|termini/i })).toBeVisible();
  });

  test('"Consigliato" badge on Personal plan', async ({ page }) => {
    await page.goto('/');
    const badge = page.locator('#prezzi').getByText('Consigliato');
    await expect(badge).toBeVisible();
  });
});

test.describe('Static Pages — Smoke Tests', () => {
  test('/privacy loads', async ({ page }) => {
    const response = await page.goto('/privacy');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('/terms loads', async ({ page }) => {
    const response = await page.goto('/terms');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('/tutorial loads', async ({ page }) => {
    const response = await page.goto('/tutorial');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
