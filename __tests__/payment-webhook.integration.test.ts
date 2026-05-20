/**
 * Integration tests for POST /api/payment/webhook.
 *
 * Mocks Stripe (signature verification bypassed) and Supabase to verify
 * that every paid plan currently sold by checkout — personal,
 * professional, business — flows through the handler correctly:
 *   - the DB UPDATE writes the matching subscription_plan value
 *   - the WhatsApp notify text uses the correct plan name and daily limit
 *
 * Without this coverage, the Professional tier added on 2026-05-17 would
 * silently break (DB CHECK constraint rejects the value, and the notify
 * text was hardcoded to "Personal" / 20 msg before FIX 4).
 */
import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();

let __stripeEvent: any = null;

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    webhooks: { constructEvent: () => __stripeEvent },
  })),
}));

const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';
const INSTANCE = 'SchedWhats-' + USER_PHONE;

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  __stripeEvent = null;
});

async function callWebhook(event: any) {
  __stripeEvent = event;
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  jest.mock('stripe', () => ({
    __esModule: true,
    default: jest.fn(() => ({
      webhooks: { constructEvent: () => __stripeEvent },
    })),
  }));
  (global as any).fetch = fetchMock.mockFetch;
  const { POST } = await import('../app/api/payment/webhook/route');
  const req: any = {
    text: () => Promise.resolve('{}'),
    headers: { get: (n: string) => (n === 'stripe-signature' ? 'sig' : null) },
  };
  return POST(req);
}

function makeCheckoutCompleted(plan: string, phone = USER_PHONE) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: phone,
        customer: 'cus_test',
        metadata: { phone, plan },
      },
    },
  };
}

describe('POST /api/payment/webhook — checkout.session.completed', () => {
  const cases: Array<{ plan: string; name: string; limit: number }> = [
    { plan: 'personal',     name: 'Personal',     limit: 20 },
    { plan: 'professional', name: 'Professional', limit: 35 },
    { plan: 'business',     name: 'Business',     limit: 50 },
  ];

  for (const { plan, name, limit } of cases) {
    describe('plan=' + plan, () => {
      beforeEach(() => {
        mockSupa.setResponse('user_instances:select', {
          instance_name: INSTANCE,
          stripe_customer_id: 'cus_test',
        });
      });

      test('writes subscription_plan=' + plan + ' to user_instances', async () => {
        const res = await callWebhook(makeCheckoutCompleted(plan));
        expect(res.status).toBe(200);

        const updateCall = mockSupa.calls.find(
          (c) => c.table === 'user_instances' && c.operation === 'update'
        );
        expect(updateCall).toBeDefined();
        expect(updateCall!.args[0]).toMatchObject({ subscription_plan: plan });
      });

      test('unpauses paused scheduled_messages', async () => {
        await callWebhook(makeCheckoutCompleted(plan));
        const unpauseCall = mockSupa.calls.find(
          (c) => c.table === 'scheduled_messages' && c.operation === 'update'
        );
        expect(unpauseCall).toBeDefined();
        expect(unpauseCall!.args[0]).toMatchObject({ status: 'pending' });
      });

      test('notifies user with "' + name + '" name and ' + limit + ' msg/day', async () => {
        await callWebhook(makeCheckoutCompleted(plan));
        const notifyCall = fetchMock.calls.find((c) =>
          c.url.includes('/message/sendText/' + INSTANCE)
        );
        expect(notifyCall).toBeDefined();
        const body = JSON.parse(String(notifyCall!.options.body));
        expect(body.number).toBe(USER_PHONE);
        expect(body.text).toContain('Piano ' + name + ' attivato');
        expect(body.text).toContain(limit + ' messaggi al giorno');
      });
    });
  }

  test('ignores unsupported plan (no DB write, no notify)', async () => {
    mockSupa.setResponse('user_instances:select', {
      instance_name: INSTANCE,
      stripe_customer_id: 'cus_test',
    });
    const res = await callWebhook(makeCheckoutCompleted('enterprise'));
    expect(res.status).toBe(200);

    const updateCall = mockSupa.calls.find(
      (c) => c.table === 'user_instances' && c.operation === 'update'
    );
    expect(updateCall).toBeUndefined();
    const notifyCall = fetchMock.calls.find((c) =>
      c.url.includes('/message/sendText/')
    );
    expect(notifyCall).toBeUndefined();
  });

  test('ignores when phone is missing from session', async () => {
    const evt = {
      type: 'checkout.session.completed',
      data: {
        object: { client_reference_id: null, customer: 'cus_test', metadata: { plan: 'personal' } },
      },
    };
    const res = await callWebhook(evt);
    expect(res.status).toBe(200);
    const updateCall = mockSupa.calls.find(
      (c) => c.table === 'user_instances' && c.operation === 'update'
    );
    expect(updateCall).toBeUndefined();
  });
});
