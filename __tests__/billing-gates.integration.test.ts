/**
 * Server-side belt of the free-beta kill-switch on the checkout path:
 * create-checkout must refuse to mint new Stripe customers/subscriptions
 * while billing is off. The UI hides the upgrade buttons, but the endpoint
 * stays directly callable — the gate lives server-side. (The Stripe portal
 * intentionally has NO such gate: existing subscribers must keep
 * self-service cancel during the beta.)
 */
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';
import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();
const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';

jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: 'b'.repeat(128),
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    STRIPE_SECRET_KEY: 'sk_test_x',
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function authedCheckout(body: any) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const cookie = await signCookie({ phone: USER_PHONE, instanceName: 'SchedWhats-' + USER_PHONE });
  const req: any = {
    cookies: { get: (n: string) => (n === AUTH_COOKIE_NAME ? { value: cookie } : undefined) },
    json: () => Promise.resolve(body),
  };
  const { POST } = await import('../app/api/payment/create-checkout/route');
  return POST(req);
}

describe('POST /api/payment/create-checkout — beta kill-switch', () => {
  test('BILLING_ENABLED=false -> 403 billing_disabled_beta BEFORE touching Stripe or the DB', async () => {
    process.env.BILLING_ENABLED = 'false';
    const res = await authedCheckout({ plan: 'personal' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('billing_disabled_beta');
    // Early return: no customer lookup/creation may have happened.
    expect(mockSupa.calls.length).toBe(0);
  });

  test('billing ON: the gate does not interfere (unconfigured price -> 400 as before)', async () => {
    delete process.env.STRIPE_PRICE_PERSONAL;
    const res = await authedCheckout({ plan: 'personal' });
    expect(res.status).toBe(400);
  });
});
