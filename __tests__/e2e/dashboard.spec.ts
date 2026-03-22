import { test, expect } from '@playwright/test';
import { mockConnectApi, mockMessages } from './helpers/mocks';

test.describe('Dashboard Page', () => {
  test('loads and shows connection form', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h2', { hasText: 'Connetti WhatsApp' })).toBeVisible();
    await expect(page.locator('input[type="tel"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Collega WhatsApp' })).toBeVisible();
  });

  test('phone input accepts a number', async ({ page }) => {
    await page.goto('/dashboard');
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill('3401234567');
    await expect(phoneInput).toHaveValue('3401234567');
  });

  test('connect shows pairing code', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/connect', async (route) => {
      const body = route.request().postDataJSON?.() ?? {};
      callCount++;

      if (body.action === 'status' && callCount <= 2) {
        // Initial session validation — no existing session
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'not_found' }),
        });
      } else if (body.action === 'getCodeAndPairing') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            instanceName: 'SchedWhats-test-instance',
            qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            pairingCode: 'ABCD-1234',
          }),
        });
      } else {
        // Subsequent status polls during connection
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'connecting' }),
        });
      }
    });

    await page.goto('/dashboard');
    await page.locator('input[type="tel"]').fill('3401234567');
    await page.locator('button', { hasText: 'Collega WhatsApp' }).click();

    // Pairing code should appear (rendered with letter-spacing, match via text content)
    await expect(page.getByText('Inserisci questo codice su WhatsApp')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button', { hasText: 'Copia Codice' })).toBeVisible();
  });

  test('connected state shows WhatsApp Connesso', async ({ page }) => {
    // Pre-set localStorage to simulate existing session, then mock status as connected
    await page.goto('/dashboard');
    await page.evaluate(() => {
      localStorage.setItem('sw_phone', '393401234567');
      localStorage.setItem('sw_instance', 'SchedWhats-test-instance');
      localStorage.setItem('sw_expiry', String(Date.now() + 30 * 24 * 3600 * 1000));
    });

    // Mock the status check to return connected
    await page.route('**/api/connect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'open', owner: '393401234567' }),
      });
    });
    await mockMessages(page);

    await page.reload();
    await expect(page.locator('h3', { hasText: 'WhatsApp Connesso' })).toBeVisible({ timeout: 15000 });
  });

  test('connected state shows messages list', async ({ page }) => {
    await page.goto('/dashboard');
    await page.evaluate(() => {
      localStorage.setItem('sw_phone', '393401234567');
      localStorage.setItem('sw_instance', 'SchedWhats-test-instance');
      localStorage.setItem('sw_expiry', String(Date.now() + 30 * 24 * 3600 * 1000));
    });

    await page.route('**/api/connect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'open', owner: '393401234567' }),
      });
    });
    await mockMessages(page);

    await page.reload();
    await expect(page.getByText('Marco Rossi')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Anna Bianchi')).toBeVisible();
  });
});
