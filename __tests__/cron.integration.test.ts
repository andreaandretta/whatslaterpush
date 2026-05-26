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
  // Default safe response for rate_limit_record RPC so happy-path tests don't
  // need to know about the new persistence layer. Tests that exercise the
  // rate-limit logic itself install their own handler via setRpcHandler.
  mockSupa.setRpcResponse('rate_limit_record', {
    key: 'default',
    minute_count: 1,
    minute_reset: Date.now() + 60000,
    daily_count: 1,
    daily_reset: Date.now() + 86400000,
    blocked: false,
    block_reason: null,
  });
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
async function callCronRoute(secret: string | null = 'test-secret', opts: { authHeader?: string } = {}) {
  // Clear module cache to re-evaluate with fresh mocks
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({
    createClient: () => mockSupa.client,
  }));
  (global as any).fetch = fetchMock.mockFetch;

  const { GET } = await import('../app/api/cron/send-messages/route');
  const url = secret === null
    ? `https://whatslaterpush.vercel.app/api/cron/send-messages`
    : `https://whatslaterpush.vercel.app/api/cron/send-messages?secret=${secret}`;
  const req = {
    url,
    headers: {
      get: (name: string) => {
        const n = name.toLowerCase();
        if (n === 'authorization') return opts.authHeader ?? null;
        return null;
      },
    },
  } as any;
  return GET(req);
}

describe('Cron integration: auth', () => {
  test('returns 401 with wrong secret', async () => {
    const res = await callCronRoute('wrong-secret');
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Unauthorized');
  });

  test('accepts CRON_SECRET via Authorization: Bearer header', async () => {
    mockSupa.setResponse('scheduled_messages:select', []);
    const res = await callCronRoute(null, { authHeader: 'Bearer test-secret' });
    expect(res.status).toBe(200);
  });

  test('rejects Authorization: Bearer with wrong token', async () => {
    const res = await callCronRoute(null, { authHeader: 'Bearer nope' });
    expect(res.status).toBe(401);
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
  // Each send now waits intra-batch jitter (max 2.5s) + typing delay
  // (max 4s, here ~600ms for "Ciao Marco!"). 7 msg in 2 batches ≈ 7s wall,
  // exceeds Jest's default 5s timeout. Bump explicitly.
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
  }, 15000);
});

// Simulates the Postgres atomic UPSERT (INSERT ... ON CONFLICT DO UPDATE with
// CASE-based window reset) that the rate_limit_record RPC performs.
// Used in the two tests below to verify the rate-limit module's behavior.
function installAtomicRpcHandler() {
  const stateMap = new Map<string, any>();
  mockSupa.setRpcHandler('rate_limit_record', (args: any) => {
    const existing = stateMap.get(args.p_key);
    let next: any;
    if (!existing) {
      next = {
        key: args.p_key,
        minute_count: 1,
        minute_reset: args.p_minute_reset,
        daily_count: 1,
        daily_reset: args.p_daily_reset,
        blocked: false,
        block_reason: null,
      };
    } else {
      const minuteExpired = args.p_now >= existing.minute_reset;
      const dailyExpired = args.p_now >= existing.daily_reset;
      next = {
        ...existing,
        minute_count: minuteExpired ? 1 : existing.minute_count + 1,
        minute_reset: minuteExpired ? args.p_minute_reset : existing.minute_reset,
        daily_count: dailyExpired ? 1 : existing.daily_count + 1,
        daily_reset: dailyExpired ? args.p_daily_reset : existing.daily_reset,
        blocked: dailyExpired ? false : existing.blocked,
        block_reason: dailyExpired ? null : existing.block_reason,
      };
    }
    stateMap.set(args.p_key, next);
    return { data: next, error: null };
  });
  return stateMap;
}

describe('Cron integration: recurring schedules', () => {
  test('after sending a recurring row, inserts the next occurrence', async () => {
    // Monday 18:00 UTC, weekly on Mondays → next is Monday +7d
    const scheduledAt = new Date('2026-06-15T18:00:00.000Z'); // Monday
    scheduledAt.setTime(scheduledAt.getTime() - 60000); // 1 min ago so it's due
    const msg = makePendingMsg({
      id: 'msg-recur-1',
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO',
      scheduled_at: scheduledAt.toISOString(),
      user_instance_id: 'ui-1',
      caption: 'Allenamento',
      parsed_message: 'Allenamento',
    });

    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-recur-1' }]);
    mockSupa.setResponse('scheduled_messages:select', [msg]);
    fetchMock.setJsonResponse('/message/sendText/', { key: { id: 'evo-msg-recur-1' } });

    const res = await callCronRoute();
    const body = await res.json();
    expect(body.sent).toBe(1);

    // Find the recurrence INSERT (NOT the existing update path)
    const insertCalls = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    const inserted = insertCalls[0].args[0];

    expect(inserted.recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(inserted.status).toBe('pending');
    expect(inserted.parent_recurrence_id).toBe('msg-recur-1');
    expect(inserted.recipient_number).toBe(msg.recipient_number);
    expect(inserted.parsed_message).toBe('Allenamento');
    // Next Monday relative to a Monday is +7d (preserves local time across no-DST window).
    // Test uses a date well within CEST (June), so the UTC offset is stable.
    expect(new Date(inserted.scheduled_at).toISOString()).toMatch(/2026-06-22T/);
  });

  test('non-recurring rows do not trigger an insert', async () => {
    const msg = makePendingMsg({ id: 'msg-oneshot' });
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-oneshot' }]);
    mockSupa.setResponse('scheduled_messages:select', [msg]);
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    await callCronRoute();

    const insertCalls = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    expect(insertCalls.length).toBe(0);
  });

  test('propagates parent_recurrence_id from existing chain', async () => {
    const scheduledAt = new Date(Date.now() - 60000);
    const msg = makePendingMsg({
      id: 'msg-chain-mid',
      parent_recurrence_id: 'msg-chain-root',
      recurrence_rule: 'FREQ=DAILY',
      scheduled_at: scheduledAt.toISOString(),
    });

    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-chain-mid' }]);
    mockSupa.setResponse('scheduled_messages:select', [msg]);
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    await callCronRoute();

    const insertCalls = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].args[0].parent_recurrence_id).toBe('msg-chain-root');
  });
});

describe('Rate limit: persistence and atomicity', () => {
  test('5 sequential recordSend persist count across calls (no in-memory reset)', async () => {
    const stateMap = installAtomicRpcHandler();
    const { recordSend } = await import('../app/lib/rate-limit');

    for (let i = 0; i < 5; i++) {
      await recordSend(mockSupa.client as any, '+39test1', 'inst-test1');
    }

    const userState = stateMap.get('user:+39test1');
    expect(userState).toBeDefined();
    expect(userState.minute_count).toBe(5);
    expect(userState.daily_count).toBe(5);
    expect(userState.blocked).toBe(false);
  });

  test('10 parallel recordSend → count = exactly 10 (no lost increments)', async () => {
    const stateMap = installAtomicRpcHandler();
    const { recordSend } = await import('../app/lib/rate-limit');

    await Promise.all(
      Array.from({ length: 10 }, () => recordSend(mockSupa.client as any, '+39test2', 'inst-test2'))
    );

    const userState = stateMap.get('user:+39test2');
    expect(userState).toBeDefined();
    expect(userState.minute_count).toBe(10);
    expect(userState.daily_count).toBe(10);

    const instState = stateMap.get('inst:inst-test2');
    expect(instState).toBeDefined();
    expect(instState.minute_count).toBe(10);
  });
});
