/**
 * Integration tests for Quick Capture flow in /api/webhook.
 */
import { createMockSupabase, createFetchMock, mockRequest, makeMessagePayload } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const fetchMock = createFetchMock();
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
    GROQ_API_KEY: 'groq-test-key',
    WEBHOOK_SECRET: 'test-webhook-secret',
    NEXT_PUBLIC_APP_URL: 'https://whatslaterpush.vercel.app',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function callWebhook(body: any, headers: Record<string, string> = {}) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  (global as any).fetch = fetchMock.mockFetch;
  const { POST } = await import('../app/api/webhook/route');
  const req = mockRequest(body, { 'x-webhook-secret': 'test-webhook-secret', ...headers });
  return POST(req as any);
}

describe('UNDO command', () => {
  test('cancels last pending message within 60s window', async () => {
    // findUserStrict: user_instances lookup
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    // UNDO query: scheduled_messages select for last pending within 60s
    mockSupa.setResponse('scheduled_messages:select',
      { id: 'msg-1', recipient_name: 'Mario', scheduled_at: new Date(Date.now() + 3600000).toISOString() }, null);
    // UNDO update: cancel the message
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-1' }], null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'undo',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    const res = await callWebhook(payload);
    expect(res.status).toBe(200);

    const updateCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'update');
    expect(updateCall).toBeTruthy();
  });

  test('does NOT trigger UNDO for "annulla 3" (existing list command)', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    // No awaiting_confirm
    mockSupa.setResponse('scheduled_messages:select', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'annulla 3',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    // The UNDO query has a specific filter `.gt('created_at', NOW-60s)`. If the UNDO
    // path was triggered by mistake, that filter would appear in the calls.
    const undoQuery = mockSupa.calls.find(c =>
      c.table === 'scheduled_messages' &&
      c.operation === 'select' &&
      c.chain.some((s: any) => s.method === 'gt' && s.args[0] === 'created_at')
    );
    expect(undoQuery).toBeFalsy();
  });
});
