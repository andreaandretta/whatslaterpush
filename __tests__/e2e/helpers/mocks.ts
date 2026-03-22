import { Page } from '@playwright/test';

export async function mockConnectApi(page: Page) {
  await page.route('**/api/connect', async (route) => {
    const request = route.request();
    const body = request.postDataJSON?.() ?? {};

    if (body.action === 'getCodeAndPairing') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          instanceName: 'SchedWhats-test-instance',
          qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          pairingCode: 'ABCD-1234',
        }),
      });
    } else if (body.action === 'status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'open', owner: '393401234567' }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    }
  });
}

export async function mockConnectionStatusConnected(page: Page) {
  await page.route('**/api/connect', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'open', owner: '393401234567' }),
    });
  });
}

export async function mockMessages(page: Page) {
  await page.route('**/api/messages*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            id: 'test-msg-1',
            recipient_name: 'Marco Rossi',
            recipient_number: '393401234567',
            parsed_message: 'Ricorda appuntamento domani',
            scheduled_at: new Date(Date.now() + 86400000).toISOString(),
            status: 'pending',
          },
          {
            id: 'test-msg-2',
            recipient_name: 'Anna Bianchi',
            recipient_number: '393409876543',
            parsed_message: 'Conferma prenotazione',
            scheduled_at: new Date(Date.now() - 86400000).toISOString(),
            status: 'sent',
          },
        ],
        subscription_plan: 'personal',
        trial_ends_at: null,
      }),
    });
  });
}

export async function mockCheckout(page: Page) {
  await page.route('**/api/payment/create-checkout', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: 'https://checkout.stripe.com/c/pay/test_session_mock',
      }),
    });
  });
}

export async function mockAuth(page: Page) {
  // Intercept Supabase auth endpoints
  await page.route('**/auth/v1/token*', async (route) => {
    const request = route.request();
    const body = request.postDataJSON?.() ?? {};

    if (body.email === 'test@example.com' && body.password === 'password123') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh-token',
          user: {
            id: 'mock-user-id',
            email: 'test@example.com',
            role: 'authenticated',
          },
        }),
      });
    } else {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
        }),
      });
    }
  });

  // Mock signup
  await page.route('**/auth/v1/signup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'mock-user-id',
        email: 'newuser@example.com',
        role: 'authenticated',
      }),
    });
  });
}
