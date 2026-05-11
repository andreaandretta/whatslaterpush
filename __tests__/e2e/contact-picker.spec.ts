/**
 * E2E test for the new "Nuovo contatto" flow.
 * Follows the same authenticated-session pattern as quick-capture-modal.spec.ts.
 * Mocks /api/contacts via route interception so the test does not depend on
 * the live Evolution instance having contacts.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const USER_PHONE = '393442582226';
const BASE = 'https://whatslaterpush.vercel.app';

let SESSION_COOKIE_VALUE = '';

test.beforeAll(async () => {
  const apiContext = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await apiContext.get(`/api/auth/check?sessionId=${SESSION_ID}`);
  if (res.status() === 410) {
    throw new Error(
      'Session already consumed or expired. Re-insert via Supabase MCP:\n' +
      `INSERT INTO pending_auth_sessions (id, phone, status, instance_name, expires_at) VALUES ('${SESSION_ID}', '${USER_PHONE}', 'authenticated', 'SchedWhats-${USER_PHONE}', NOW() + INTERVAL '30 minutes');`
    );
  }
  expect(res.status()).toBe(200);
  const setCookie = res.headers()['set-cookie'] || '';
  const match = setCookie.match(/sw_session=([^;]+)/);
  if (!match) throw new Error('No sw_session cookie');
  SESSION_COOKIE_VALUE = match[1];
  await apiContext.dispose();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'sw_session',
    value: SESSION_COOKIE_VALUE,
    domain: 'whatslaterpush.vercel.app',
    path: '/',
    secure: true,
    sameSite: 'Lax',
  }]);
});

test.describe('Contact picker + direct scheduling', () => {
  test('dashboard shows both buttons', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /Nuovo contatto/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nuovo follow-up/i })).toBeVisible();
  });

  test('clicking Nuovo contatto opens picker with mocked contact list', async ({ page }) => {
    await page.route('**/api/contacts', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contacts: [
            { number: '393339998877', name: 'Anna Test', pushName: 'Anna' },
            { number: '393331112233', name: 'Marco Test', pushName: 'Marco' },
          ],
        }),
      })
    );

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo contatto/i }).click();

    await expect(page.getByText('Nuovo messaggio')).toBeVisible();
    await expect(page.getByText('Anna Test')).toBeVisible();
    await expect(page.getByText('Marco Test')).toBeVisible();
  });

  test('search filters the contact list', async ({ page }) => {
    await page.route('**/api/contacts', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contacts: [
            { number: '393339998877', name: 'Anna Test' },
            { number: '393331112233', name: 'Marco Test' },
          ],
        }),
      })
    );

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo contatto/i }).click();
    await page.getByPlaceholder(/Cerca contatto/i).fill('Anna');

    await expect(page.getByText('Anna Test')).toBeVisible();
    await expect(page.getByText('Marco Test')).not.toBeVisible();
  });

  test('manual entry → schedule modal → POST → success', async ({ page }) => {
    await page.route('**/api/contacts', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contacts: [] }) })
    );

    let postBody: any = null;
    await page.route('**/api/messages', async (route) => {
      if (route.request().method() === 'POST') {
        postBody = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'new-uuid', scheduled_at: postBody.scheduled_at, status: 'pending' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo contatto/i }).click();

    await page.getByPlaceholder(/Nome \(opzionale\)/i).fill('Test Persona');
    await page.getByPlaceholder(/Numero/i).fill('3331234567');
    await page.getByRole('button', { name: /Continua/i }).click();

    await expect(page.getByText('Test Persona')).toBeVisible();
    await page.getByRole('button', { name: /Domani 9:00/i }).click();
    await page.getByPlaceholder(/Scrivi il messaggio/i).fill('Messaggio di test e2e');
    await page.getByRole('button', { name: /^Schedula$/i }).click();

    await expect.poll(() => postBody?.recipient_number).toBe('393331234567');
    expect(postBody?.recipient_name).toBe('Test Persona');
    expect(postBody?.message).toBe('Messaggio di test e2e');
  });

  test('Evolution error shows banner + auto-expands manual entry', async ({ page }) => {
    await page.route('**/api/contacts', (route) =>
      route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'evolution_timeout' }) })
    );

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo contatto/i }).click();

    await expect(page.getByText(/Caricamento contatti scaduto|inserire il numero manualmente/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Numero/i)).toBeVisible();
  });
});
