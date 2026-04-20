import { test, expect, request as playwrightRequest } from '@playwright/test';

/**
 * E2E test for Quick Capture modal flow on production.
 * Uses a pre-authenticated session injected via Supabase MCP — before running,
 * ensure a row exists in pending_auth_sessions with id=SESSION_ID, status='authenticated',
 * phone=USER_PHONE, instance_name=SchedWhats-{USER_PHONE}, expires_at in the future.
 *
 * The session is claimed once in beforeAll (which consumes+deletes the row).
 * The resulting sw_session cookie is reused across all tests via context.addCookies().
 */

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

  // Extract Set-Cookie header
  const headers = res.headers();
  const setCookie = headers['set-cookie'] || '';
  const match = setCookie.match(/sw_session=([^;]+)/);
  if (!match) throw new Error(`No sw_session cookie in response headers: ${JSON.stringify(headers)}`);
  SESSION_COOKIE_VALUE = match[1];
  expect(SESSION_COOKIE_VALUE.length).toBeGreaterThan(40); // HMAC signed cookie is long
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

test.describe('Quick Capture modal (authenticated)', () => {
  test('dashboard loads with Nuovo follow-up button visible', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.getByRole('button', { name: /Nuovo follow-up/i })).toBeVisible();
  });

  test('clicking button opens modal with 4 fields + 3 presets', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo follow-up/i }).click();

    await expect(page.getByRole('dialog')).toBeVisible();

    await expect(page.getByPlaceholder('Mario Cementi')).toBeVisible();
    await expect(page.getByPlaceholder('393331234567')).toBeVisible();
    await expect(page.locator('input[type="datetime-local"]')).toBeVisible();
    await expect(page.getByPlaceholder(/preventivo/i)).toBeVisible();

    await expect(page.getByRole('button', { name: 'Tra 1h' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Domani 9:00' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stasera 18:00' })).toBeVisible();

    await expect(page.getByRole('button', { name: /Apri WhatsApp e invia/i })).toBeVisible();
  });

  test('filling fields generates correct wa.me deep-link', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo follow-up/i }).click();

    await page.getByPlaceholder('Mario Cementi').fill('Test Playwright');
    await page.getByPlaceholder('393331234567').fill('393334445555');
    await page.getByRole('button', { name: 'Tra 1h' }).click();
    await page.getByPlaceholder(/preventivo/i).fill('test message from playwright');

    // Block navigation to wa.me (external) and capture the intended URL
    await page.route('**/wa.me/**', (route) => route.abort());

    const navPromise = page.waitForRequest(
      (request) => request.url().includes('wa.me/'),
      { timeout: 8000 }
    );

    await page.getByRole('button', { name: /Apri WhatsApp e invia/i }).click();

    const navRequest = await navPromise;
    const waUrl = navRequest.url();

    expect(waUrl).toContain(`wa.me/${USER_PHONE}`);
    expect(waUrl).toContain('text=');

    const textParam = new URL(waUrl).searchParams.get('text') || '';
    expect(textParam).toContain('Test Playwright');
    expect(textParam).toContain('393334445555');
    expect(textParam).toContain('test message from playwright');
    expect(textParam).toMatch(/(oggi|domani|il \d{2}\/\d{2}) alle \d{2}:\d{2}/);
  });

  test('invalid phone shows error, no navigation', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo follow-up/i }).click();

    await page.getByPlaceholder('Mario Cementi').fill('X');
    await page.getByPlaceholder('393331234567').fill('abc');
    await page.getByPlaceholder(/preventivo/i).fill('test');

    await page.getByRole('button', { name: /Apri WhatsApp e invia/i }).click();

    await expect(page.getByText(/Numero non valido/i)).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
