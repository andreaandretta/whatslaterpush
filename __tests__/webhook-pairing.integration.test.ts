/**
 * Integration test for /api/webhook CONNECTION_UPDATE state=open pairing path.
 * C1 FIX: pairing_completed must carry egress_id (resolved from the latest
 * pairing_started for the instance) so the per-egress watchdog counts the
 * completion against the right egress and does NOT quarantine a healthy egress.
 */
import { createMockSupabase, mockRequest, makeConnectionPayload } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

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
afterEach(() => { process.env = ORIGINAL_ENV; });

async function postWebhook(body: any) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { POST } = await import('../app/api/webhook/route');
  const req: any = mockRequest(body, { 'x-webhook-secret': 'whk-test', 'Content-Type': 'application/json' });
  return POST(req);
}

function findPairingCompleted() {
  return mockSupa.calls.find(c =>
    c.table === 'audit_events' && c.operation === 'insert' && c.args[0]?.event_type === 'pairing_completed');
}

describe('Webhook pairing_completed — C1 egress_id', () => {
  test('carries egress_id resolved from the latest pairing_started for the instance', async () => {
    mockSupa.setResponse('pending_auth_sessions:update', [{ id: 'sess-1' }]); // real pending->auth flip
    mockSupa.setResponse('audit_events:select', { payload: { egress_id: 'eg-1', instance_name: 'SchedWhats-393331234567' } });

    const res = await postWebhook(makeConnectionPayload({
      instance: 'SchedWhats-393331234567',
      state: 'open',
      ownerJid: '393331234567@s.whatsapp.net',
    }));
    expect(res.status).toBe(200);

    const completed = findPairingCompleted();
    expect(completed).toBeDefined();
    expect(completed!.args[0].payload.egress_id).toBe('eg-1');
    expect(completed!.args[0].payload.instance_name).toBe('SchedWhats-393331234567');
  });

  test('egress_id is null (not missing) when no pairing_started exists — legacy aggregation still works', async () => {
    mockSupa.setResponse('pending_auth_sessions:update', [{ id: 'sess-1' }]);
    mockSupa.setResponse('audit_events:select', null);

    const res = await postWebhook(makeConnectionPayload({
      instance: 'SchedWhats-393339999999', state: 'open', ownerJid: '393339999999@s.whatsapp.net',
    }));
    expect(res.status).toBe(200);
    const completed = findPairingCompleted();
    expect(completed).toBeDefined();
    expect(completed!.args[0].payload).toHaveProperty('egress_id', null);
  });

  test('no pairing_completed when the pending_auth_sessions UPDATE flips 0 rows (reconnect / 515 re-fire)', async () => {
    mockSupa.setResponse('pending_auth_sessions:update', []); // already authenticated
    mockSupa.setResponse('audit_events:select', { payload: { egress_id: 'eg-1' } });

    const res = await postWebhook(makeConnectionPayload({
      instance: 'SchedWhats-393331234567', state: 'open', ownerJid: '393331234567@s.whatsapp.net',
    }));
    expect(res.status).toBe(200);
    expect(findPairingCompleted()).toBeUndefined();
  });
});

describe('Webhook instance_disconnect — #4 benign-515 guard', () => {
  const findDisconnectAudit = () => mockSupa.calls.find(c =>
    c.table === 'audit_events' && c.operation === 'insert' && c.args[0]?.event_type === 'instance_disconnect');

  test('does NOT audit instance_disconnect for benign 515 (restartRequired after pairing)', async () => {
    const res = await postWebhook({
      event: 'connection.update', instance: 'SchedWhats-393331234567', data: { state: 'close', statusReason: 515 },
    });
    expect(res.status).toBe(200);
    expect(findDisconnectAudit()).toBeUndefined();
  });

  test('audits instance_disconnect for a real disconnect code (e.g. 403 forbidden / ban)', async () => {
    const res = await postWebhook({
      event: 'connection.update', instance: 'SchedWhats-393331234567', data: { state: 'close', statusReason: 403 },
    });
    expect(res.status).toBe(200);
    const audit = findDisconnectAudit();
    expect(audit).toBeDefined();
    expect(audit!.args[0].payload.code).toBe(403);
  });
});

// connection_status arriva SOLO da questo webhook. Con Supabase in Gateway
// Timeout (9-14 set 2026) l'UPDATE falliva, il webhook rispondeva 200 ed
// Evolution non lo rimandava: un 'close' vero (logout 401) perso lasciava la
// riga 'open' per sempre. Con un 5xx Evolution 2.3.7 riprova (webhook.controller
// retryWebhookRequest: 10 tentativi, backoff; non riprova solo 400/401/403/404/422).
describe('Webhook CONNECTION_UPDATE — failed DB write is not acknowledged', () => {
  afterEach(() => { mockSupa.setResponse('user_instances:update', null); });

  test('user_instances update error → 5xx so Evolution retries the event', async () => {
    mockSupa.setResponse('user_instances:update', null, { message: 'Gateway Timeout' });
    const res = await postWebhook({
      event: 'connection.update', instance: 'SchedWhats-393331234567', data: { state: 'close', statusReason: 401 },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    // niente onboarding/welcome su uno stato che non abbiamo salvato
    expect(mockSupa.calls.filter(c => c.table === 'user_instances' && c.operation === 'select')).toHaveLength(0);
  });

  test('state=open with a failed write is retried too (no welcome sent on an unsaved state)', async () => {
    mockSupa.setResponse('user_instances:update', null, { message: 'Gateway Timeout' });
    const res = await postWebhook({
      event: 'connection.update', instance: 'SchedWhats-393331234567', data: { state: 'open', wuid: '393331234567@s.whatsapp.net' },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(mockSupa.calls.filter(c => c.table === 'pending_auth_sessions' && c.operation === 'update'
      && c.args[0]?.status === 'authenticated')).toHaveLength(0);
  });

  test('successful write still answers 200', async () => {
    mockSupa.setResponse('user_instances:update', [{ id: 'ui-1', phone_number: '393331234567' }]);
    const res = await postWebhook({
      event: 'connection.update', instance: 'SchedWhats-393331234567', data: { state: 'close', statusReason: 428 },
    });
    expect(res.status).toBe(200);
  });
});
