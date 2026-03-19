/**
 * Integration tests for /api/cron/send-messages route.
 * Mocks: Supabase client, global fetch, env vars.
 */
import { createMockSupabase, createFetchMock } from './helpers/mocks';

// Mock Supabase before importing route
const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

// Mock fetch
const fetchMock = createFetchMock();

// Env vars
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    CRON_SECRET: 'test-secret',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// Helper to build a pending message with joined user_instances
function makePendingMsg(overrides: any = {}) {
  const { user_instances: instOverrides, ...msgOverrides } = overrides;
  return {
    id: 'msg-1',
    scheduled_at: new Date(Date.now() - 60000).toISOString(), // 1 min ago
    status: 'pending',
    retry_count: 0,
    recipient_number: '393401234567',
    recipient_name: 'Marco',
    parsed_message: 'Ciao Marco!',
    instance_phone: '393501234567',
    user_instances: {
      id: 'ui-1',
      phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      subscription_plan: 'trial',
      connection_status: 'open',
      ...instOverrides,
    },
    ...msgOverrides,
  };
}

// Helper to call the GET handler
async function callCronRoute(secret = 'test-secret') {
  // Clear module cache to re-evaluate with fresh mocks
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({
    createClient: () => mockSupa.client,
  }));
  (global as any).fetch = fetchMock.mockFetch;

  const { GET } = await import('../app/api/cron/send-messages/route');
  const url = `https://whatslaterpush.vercel.app/api/cron/send-messages?secret=${secret}`;
  const req = {
    url,
    headers: { get: (name: string) => name === 'x-vercel-cron' ? null : null },
  } as any;
  return GET(req);
}

describe('Cron integration: auth', () => {
  test('returns 401 with wrong secret', async () => {
    const res = await callCronRoute('wrong-secret');
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });
});

describe('Cron integration: send flow', () => {
  test('sends pending message via Evolution API and marks sent', async () => {
    const msg = makePendingMsg();

    // Stale cleanup returns nothing
    // Atomic lock + other updates return claimed row
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-1' }]);
    // Main query returns 1 pending message
    mockSupa.setResponse('scheduled_messages:select', [msg]);

    // Evolution API send succeeds
    fetchMock.setJsonResponse('/message/sendText/', { key: { id: 'evo-msg-1' } });

    const res = await callCronRoute();
    const body = await res.json();

    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);

    // Verify Evolution API was called with correct number
    const evoCalls = fetchMock.calls.filter(c => c.url.includes('/message/sendText/'));
    expect(evoCalls.length).toBeGreaterThanOrEqual(1);
    const sendCall = evoCalls[0];
    const sendBody = JSON.parse(sendCall.options.body as string);
    expect(sendBody.number).toBe('393401234567');
    expect(sendBody.text).toBe('Ciao Marco!');
  });

  test('handles Evolution API failure with retry', async () => {
    const msg = makePendingMsg({ retry_count: 0 });

    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-1' }]);
    mockSupa.setResponse('scheduled_messages:select', [msg]);

    // Evolution API fails
    fetchMock.setJsonResponse('/message/sendText/', { error: 'instance not connected' }, 500);

    const res = await callCronRoute();
    const body = await res.json();

    // Message should fail (Promise rejected) but not be permanently failed (retry_count < 3)
    // The route uses Promise.allSettled, so rejected = goes to error handler
    expect(body.sent).toBe(0);
  });

  test('marks message failed after 3 retries', async () => {
    const msg = makePendingMsg({ retry_count: 2 }); // This will be attempt 3

    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-1' }]);
    mockSupa.setResponse('scheduled_messages:select', [msg]);

    // Evolution API fails
    fetchMock.setJsonResponse('/message/sendText/', { error: 'instance not connected' }, 500);

    const res = await callCronRoute();
    const body = await res.json();

    expect(body.sent).toBe(0);
    expect(body.failed).toBe(1);
  });
});

describe('Cron integration: disconnected instances', () => {
  test('reschedules message to tomorrow when instance disconnected', async () => {
    const msg = makePendingMsg({
      user_instances: { connection_status: 'close' },
    });

    mockSupa.setResponse('scheduled_messages:update', []);
    mockSupa.setResponse('scheduled_messages:select', [msg]);

    const res = await callCronRoute();
    const body = await res.json();

    expect(body.disconnected).toBe(1);
    expect(body.sent).toBe(0);

    // Verify no Evolution API calls were made (don't try to send)
    const evoCalls = fetchMock.calls.filter(c => c.url.includes('/message/sendText/'));
    expect(evoCalls.length).toBe(0);
  });
});

describe('Cron integration: trial expiry', () => {
  test('cancels message and notifies user when trial expired', async () => {
    const msg = makePendingMsg({
      user_instances: {
        subscription_plan: 'trial',
        trial_ends_at: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
      },
    });

    mockSupa.setResponse('scheduled_messages:update', []);
    mockSupa.setResponse('scheduled_messages:select', [msg]);

    // For trial expiry notification
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callCronRoute();
    const body = await res.json();

    expect(body.trialExpired).toBe(1);
    expect(body.sent).toBe(0);

    // Should have sent a notification to owner about trial expiry
    const evoCalls = fetchMock.calls.filter(c => c.url.includes('/message/sendText/'));
    expect(evoCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Cron integration: empty queue', () => {
  test('returns zeros when no pending messages', async () => {
    mockSupa.setResponse('scheduled_messages:update', []);
    mockSupa.setResponse('scheduled_messages:select', []);

    const res = await callCronRoute();
    const body = await res.json();

    expect(body.sent).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.skipped).toBe(0);
  });
});

describe('Cron integration: batch processing', () => {
  test('processes multiple messages in batches', async () => {
    const messages = Array.from({ length: 7 }, (_, i) =>
      makePendingMsg({
        id: `msg-${i}`,
        recipient_number: `39340123456${i}`,
        recipient_name: `User${i}`,
      })
    );

    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-0' }]);
    mockSupa.setResponse('scheduled_messages:select', messages);
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callCronRoute();
    const body = await res.json();

    // All 7 should be sent (processed in 2 batches: 5 + 2)
    expect(body.sent).toBe(7);
  });
});
