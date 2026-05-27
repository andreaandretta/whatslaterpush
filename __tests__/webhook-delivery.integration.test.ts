/**
 * Integration tests for /api/webhook handling of messages.update events.
 * Mocks Supabase + verifyCookie env.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    WEBHOOK_SECRET: 'whk-test',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makeUpdatePayload(opts: { instance: string; updates: Array<{ keyId: string; status: number }> }) {
  return {
    event: 'messages.update',
    instance: opts.instance,
    data: opts.updates.map(u => ({
      key: { id: u.keyId, remoteJid: '393401234567@s.whatsapp.net', fromMe: true },
      update: { status: u.status },
    })),
  };
}

async function postWebhook(body: any) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { POST } = await import('../app/api/webhook/route');
  const req: any = mockRequest(body, {
    'x-webhook-secret': 'whk-test',
    'Content-Type': 'application/json',
  });
  return POST(req);
}

describe('Webhook messages.update', () => {
  test('status=3 (DELIVERY_ACK) sets delivered_at on matched row', async () => {
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'sm-1' }]);

    const res = await postWebhook(makeUpdatePayload({
      instance: 'X',
      updates: [{ keyId: 'EVO_MSG_123', status: 3 }],
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.touched).toBeGreaterThanOrEqual(1);

    // Verify the UPDATE was targeted at evolution_message_id with delivered_at fill-if-null
    const updates = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'update');
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const first = updates[0];
    expect(first.args[0].delivered_at).toBeDefined();
    // The .eq('evolution_message_id', 'EVO_MSG_123') should be in chain
    const eqCall = first.chain.find(c => c.method === 'eq' && c.args[0] === 'evolution_message_id');
    expect(eqCall?.args[1]).toBe('EVO_MSG_123');
    // And .is('delivered_at', null) for fill-if-null semantics
    const isCall = first.chain.find(c => c.method === 'is' && c.args[0] === 'delivered_at');
    expect(isCall?.args[1]).toBeNull();
  });

  test('status=4 (READ) sets BOTH delivered_at and read_at (read implies delivered)', async () => {
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'sm-1' }]);

    const res = await postWebhook(makeUpdatePayload({
      instance: 'X',
      updates: [{ keyId: 'EVO_MSG_999', status: 4 }],
    }));
    expect(res.status).toBe(200);

    const updates = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'update');
    // Expect 2 update calls — one for delivered_at, one for read_at
    expect(updates.length).toBe(2);
    expect(updates[0].args[0].delivered_at).toBeDefined();
    expect(updates[0].args[0].read_at).toBeUndefined();
    expect(updates[1].args[0].read_at).toBeDefined();
    expect(updates[1].args[0].delivered_at).toBeUndefined();
  });

  test('multiple updates in same payload are processed sequentially', async () => {
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'sm-x' }]);

    await postWebhook(makeUpdatePayload({
      instance: 'X',
      updates: [
        { keyId: 'EVO_A', status: 3 },
        { keyId: 'EVO_B', status: 4 },
      ],
    }));

    const updates = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'update');
    // EVO_A: 1 update (delivered). EVO_B: 2 updates (delivered + read). Total: 3.
    expect(updates.length).toBe(3);
  });

  test('ignores statuses other than 3 and 4', async () => {
    const res = await postWebhook(makeUpdatePayload({
      instance: 'X',
      updates: [
        { keyId: 'EVO_C', status: 1 }, // PENDING — ignore
        { keyId: 'EVO_D', status: 2 }, // SERVER_ACK — ignore (we already set sent_at when sending)
        { keyId: 'EVO_E', status: 5 }, // PLAYED (audio) — ignore for now
      ],
    }));
    expect(res.status).toBe(200);
    const updates = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'update');
    expect(updates.length).toBe(0);
  });

  test('idempotent: .is(field, null) prevents overwriting already-set timestamps', async () => {
    // Simulate: row already has delivered_at set → .is('delivered_at', null) → 0 rows updated.
    mockSupa.setResponse('scheduled_messages:update', []);

    const res = await postWebhook(makeUpdatePayload({
      instance: 'X',
      updates: [{ keyId: 'EVO_DUP', status: 3 }],
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.touched).toBe(0);
    // We still call the UPDATE — but with .is('delivered_at', null) the matched row count is 0.
    const updates = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'update');
    expect(updates.length).toBe(1);
  });
});
