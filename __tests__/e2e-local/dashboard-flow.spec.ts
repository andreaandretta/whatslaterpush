import { test, expect, devices, type BrowserContext } from '@playwright/test';

// Must be set BEFORE signCookie() runs (read lazily inside the call), and must
// match the AUTH_COOKIE_SECRET the dev server boots with (playwright.local.config.ts).
const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.AUTH_COOKIE_SECRET = TEST_SECRET;

import { signCookie, AUTH_COOKIE_NAME } from '../../app/lib/auth-cookie';

const PHONE = '393331112222';
const INSTANCE = 'SchedWhats-' + PHONE;

const failedMsg = {
  id: 'msg-failed-1',
  recipient_name: 'Mario Rossi',
  recipient_number: '393334445566',
  parsed_message: 'Ciao Mario, ti aspetto domani alle 18 per l’allenamento!',
  caption: '',
  scheduled_at: new Date(Date.now() - 3_600_000).toISOString(),
  status: 'failed',
  error_message: 'HTTP 400: number not on whatsapp',
  retry_count: 3,
  photo_url: null,
  sent_at: null,
  delivered_at: null,
  read_at: null,
};

function messagesPayload(messages: unknown[]) {
  return {
    messages,
    subscription_plan: 'personal',
    trial_ends_at: null,
    connection_status: 'open',
    total_scheduled_lifetime: 5,
  };
}

async function setSessionCookie(context: BrowserContext) {
  const value = await signCookie({ phone: PHONE, instanceName: INSTANCE });
  await context.addCookies([{
    name: AUTH_COOKIE_NAME,
    value,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
}

test.describe('Dashboard — flusso "Non inviato" + Riprova', () => {
  test('card rossa + reason mappata, tap Riprova → PATCH action:retry → la card esce dalla coda', async ({ page, context }) => {
    await setSessionCookie(context);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: { phone: PHONE, instanceName: INSTANCE } }));

    let retried = false;
    let patchBody: any = null;
    await page.route('**/api/messages', async (route) => {
      const req = route.request();
      if (req.method() === 'PATCH') {
        patchBody = req.postDataJSON();
        retried = true;
        await new Promise((res) => setTimeout(res, 400)); // observe the in-flight spinner
        return route.fulfill({ json: { message: { id: failedMsg.id, status: 'pending', scheduled_at: new Date().toISOString() } } });
      }
      // GET: failed before retry; after retry it's back to pending (→ leaves the Non inviati section)
      const msgs = retried
        ? [{ ...failedMsg, status: 'pending', error_message: null, scheduled_at: new Date(Date.now() + 60_000).toISOString() }]
        : [failedMsg];
      return route.fulfill({ json: messagesPayload(msgs) });
    });

    await page.goto('/dashboard');

    // Red "Non inviato" card with the human reason (never a raw HTTP code)
    await expect(page.getByText('Non inviati', { exact: true })).toBeVisible();
    await expect(page.getByText('Non inviato', { exact: true })).toBeVisible();
    await expect(page.getByText('Mario Rossi')).toBeVisible();
    await expect(page.getByText('Numero non su WhatsApp')).toBeVisible();
    await expect(page.getByText(/HTTP 400/)).toHaveCount(0); // raw error never leaks to the UI

    const retry = page.getByRole('button', { name: 'Riprova' });
    await expect(retry).toBeVisible();
    await page.screenshot({ path: 'test-results/local-failed-card.png' });

    // Tap Riprova → in-flight loading label
    await retry.click();
    await expect(page.getByText('Rimetto in coda…')).toBeVisible();

    // After PATCH + refetch the message is pending → the Non inviati section disappears
    await expect(page.getByText('Non inviati', { exact: true })).toBeHidden({ timeout: 10_000 });

    // The retry hit the backend with the right contract
    expect(retried).toBe(true);
    expect(patchBody).toMatchObject({ id: failedMsg.id, action: 'retry' });
  });
});

const iphone = devices['iPhone 13'];
test.describe('iOS — bottom sheet installazione', () => {
  // Spread only the emulation props — NOT defaultBrowserType, which would force
  // a separate worker and is irrelevant (we run the iOS Safari UA on chromium).
  test.use({
    userAgent: iphone.userAgent,
    viewport: iphone.viewport,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: iphone.isMobile,
    hasTouch: iphone.hasTouch,
  });

  test('tap "Installa" apre un bottom sheet ancorato in basso (non tagliato in cima)', async ({ page, context }) => {
    await setSessionCookie(context);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: { phone: PHONE, instanceName: INSTANCE } }));
    await page.route('**/api/messages', (r) => r.fulfill({ json: messagesPayload([]) }));
    // Block the SW so chromium never marks the page installable → no beforeinstallprompt
    // → deferred stays null → the iOS (manual-guide) path, exactly like real Safari.
    await page.route('**/sw.js', (r) => r.fulfill({ status: 404, body: '' }));

    await page.goto('/dashboard');

    const installBtn = page.getByRole('button', { name: /Installa/i });
    await expect(installBtn).toBeVisible();
    await installBtn.click();

    const dialog = page.getByRole('dialog', { name: /installare/i });
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Installa WhatsLater su iPhone')).toBeVisible();
    await expect(page.getByText(/Aggiungi a Home/i)).toBeVisible();

    // The panel is bottom-anchored (the whole point of the fix), not clipped at the top.
    const panel = dialog.locator('.rounded-t-2xl');
    const box = await panel.boundingBox();
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeGreaterThan(vp.height - 5); // bottom edge ≈ viewport bottom
    expect(box!.y).toBeGreaterThan(vp.height / 3);               // top is in the lower screen, not behind the status bar

    await page.screenshot({ path: 'test-results/local-ios-install-sheet.png' });
  });
});
