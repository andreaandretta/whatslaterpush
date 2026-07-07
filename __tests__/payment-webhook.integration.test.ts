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
  // Idempotency ledger empty by default (no dedup); the idempotency test overrides.
  mockSupa.setResponse('processed_stripe_events:select', null);
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_PERSONAL: 'price_pers',
    STRIPE_PRICE_PROFESSIONAL: 'price_prof',
    STRIPE_PRICE_BUSINESS: 'price_biz',
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

function makeCheckoutCompleted(plan: string, phone = USER_PHONE, paymentStatus: string = 'paid') {
  return {
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: phone,
        customer: 'cus_test',
        payment_status: paymentStatus,
        metadata: { phone, plan },
      },
    },
  };
}

function makeSubscriptionUpdated(status: string, priceId: string, customer = 'cus_test') {
  return {
    id: 'evt_sub_upd',
    type: 'customer.subscription.updated',
    data: { object: { customer, status, items: { data: [{ price: { id: priceId } }] } } },
  };
}

function makeInvoicePaymentFailed(customer = 'cus_test') {
  return {
    id: 'evt_inv_failed',
    type: 'invoice.payment_failed',
    data: { object: { customer } },
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
      id: 'evt_nophone',
      type: 'checkout.session.completed',
      data: {
        object: { client_reference_id: null, customer: 'cus_test', payment_status: 'paid', metadata: { plan: 'personal' } },
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

describe('POST /api/payment/webhook — FIX 4: payment_status gate', () => {
  test('does NOT grant when checkout payment_status != paid', async () => {
    mockSupa.setResponse('user_instances:select', { instance_name: INSTANCE, stripe_customer_id: 'cus_test' });
    const res = await callWebhook(makeCheckoutCompleted('business', USER_PHONE, 'unpaid'));
    expect(res.status).toBe(200);
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeUndefined();
    const notifyCall = fetchMock.calls.find((c) => c.url.includes('/message/sendText/'));
    expect(notifyCall).toBeUndefined();
  });
});

describe('POST /api/payment/webhook — FIX 4: customer.subscription.updated', () => {
  test('syncs plan UP/DOWN from the active price (portal change)', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'personal' });
    const res = await callWebhook(makeSubscriptionUpdated('active', 'price_biz'));
    expect(res.status).toBe(200);
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall!.args[0]).toMatchObject({ subscription_plan: 'business' });
  });

  test('past_due KEEPS the tier (grace — no downgrade on a recoverable blip)', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'business' });
    await callWebhook(makeSubscriptionUpdated('past_due', 'price_biz'));
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeUndefined();
  });

  test('canceled -> free (subscription truly ended)', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'business' });
    await callWebhook(makeSubscriptionUpdated('canceled', 'price_biz'));
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall!.args[0]).toMatchObject({ subscription_plan: 'free' });
  });

  test('no DB write when the resolved plan already matches the stored plan', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'business' });
    await callWebhook(makeSubscriptionUpdated('active', 'price_biz'));
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeUndefined();
  });

  test('unknown price on active status -> no clobber (null = leave plan as-is)', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'business' });
    await callWebhook(makeSubscriptionUpdated('active', 'price_unknown'));
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeUndefined();
  });
});

describe('POST /api/payment/webhook — FIX 4: invoice.payment_failed (tier-neutral + nudge)', () => {
  test('does NOT change the tier, and nudges a paying user to update their card', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'business' });
    await callWebhook(makeInvoicePaymentFailed());
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeUndefined(); // grace: no downgrade
    const notifyCall = fetchMock.calls.find((c) => c.url.includes('/message/sendText/' + INSTANCE));
    expect(notifyCall).toBeDefined();
    expect(JSON.parse(String(notifyCall!.options.body)).text).toContain('Aggiorna il metodo di pagamento');
  });

  test('no tier change and no nudge when the user is already free', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'free' });
    await callWebhook(makeInvoicePaymentFailed());
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeUndefined();
    const notifyCall = fetchMock.calls.find((c) => c.url.includes('/message/sendText/'));
    expect(notifyCall).toBeUndefined();
  });
});

describe('POST /api/payment/webhook — unpause filtrato (runbook §2)', () => {
  // An unfiltered unpause resurrects months-old paused rows at the exact
  // moment of highest trust (first payment) and floods the user's real
  // clients with stale content. Only trial-paused rows inside the recency
  // window may come back; manually-paused rows keep the user's choice.
  test('unpause targets ONLY trial-paused rows within the recency window', async () => {
    mockSupa.setResponse('user_instances:select', { instance_name: INSTANCE, stripe_customer_id: 'cus_test' });
    await callWebhook(makeCheckoutCompleted('personal'));
    const unpauseCall = mockSupa.calls.find(
      (c) => c.table === 'scheduled_messages' && c.operation === 'update'
    );
    expect(unpauseCall).toBeDefined();
    expect(unpauseCall!.args[0]).toMatchObject({ status: 'pending', error_message: null, send_attempted_at: null });
    const like = unpauseCall!.chain.find((s) => s.method === 'like');
    expect(like).toBeDefined();
    expect(like!.args).toEqual(['error_message', 'Trial scaduto%']);
    const gte = unpauseCall!.chain.find((s) => s.method === 'gte');
    expect(gte).toBeDefined();
    expect(gte!.args[0]).toBe('scheduled_at');
  });
});

describe('POST /api/payment/webhook — notify gate sotto beta (BILLING_ENABLED=false)', () => {
  // The webhook stays ON during the beta (DB must keep mirroring Stripe for a
  // clean reactivation), but its WhatsApp texts are billing copy — pricing,
  // "3 messaggi/giorno", "aggiorna il metodo di pagamento" — pointing at a UI
  // the beta does not render. State sync yes, messaging no.
  beforeEach(() => {
    process.env.BILLING_ENABLED = 'false';
  });

  test('checkout completed: DB sync happens, WhatsApp notify does NOT', async () => {
    mockSupa.setResponse('user_instances:select', { instance_name: INSTANCE, stripe_customer_id: 'cus_test' });
    await callWebhook(makeCheckoutCompleted('personal'));
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeDefined();
    expect(fetchMock.calls.find((c) => c.url.includes('/message/sendText/'))).toBeUndefined();
  });

  test('subscription deleted: plan→free sync happens, notify does NOT', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE });
    await callWebhook({ id: 'evt_del', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_test' } } });
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall!.args[0]).toMatchObject({ subscription_plan: 'free' });
    expect(fetchMock.calls.find((c) => c.url.includes('/message/sendText/'))).toBeUndefined();
  });

  test('invoice payment_failed: no card nudge under beta', async () => {
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'business' });
    await callWebhook(makeInvoicePaymentFailed());
    expect(fetchMock.calls.find((c) => c.url.includes('/message/sendText/'))).toBeUndefined();
  });
});

describe('POST /api/payment/webhook — FIX 4: idempotency', () => {
  test('skips an event already in processed_stripe_events (no side effects)', async () => {
    mockSupa.setResponse('processed_stripe_events:select', { event_id: 'evt_sub_upd' });
    mockSupa.setResponse('user_instances:select', { phone_number: USER_PHONE, instance_name: INSTANCE, subscription_plan: 'personal' });
    const res = await callWebhook(makeSubscriptionUpdated('active', 'price_biz'));
    expect(res.status).toBe(200);
    const updateCall = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCall).toBeUndefined(); // deduplicated -> no tier change
  });
});
