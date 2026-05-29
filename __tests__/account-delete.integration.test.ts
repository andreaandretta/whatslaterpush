/**
 * Integration tests for POST /api/account/delete — GDPR right-to-be-forgotten.
 * Verifies auth, confirmation match, cascade order, audit logging, and the
 * best-effort Evolution disconnect.
 */
import { createMockSupabase, createFetchMock, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const fetchMock = createFetchMock();
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
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function callDelete(body: any, opts: { authed?: boolean } = { authed: true }) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  (global as any).fetch = fetchMock.mockFetch;
  const { POST } = await import('../app/api/account/delete/route');

  const cookies: Record<string, string> = {};
  if (opts.authed) {
    const value = await signCookie({ phone: USER_PHONE, instanceName: INSTANCE });
    cookies[AUTH_COOKIE_NAME] = value;
  }
  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  req.cookies = { get: (name: string) => cookies[name] ? { value: cookies[name] } : undefined };
  return POST(req);
}

function mockUserInstanceLookup() {
  mockSupa.setResponse('user_instances:select', { instance_name: INSTANCE });
}

describe('POST /api/account/delete — auth gate', () => {
  test('401 when no session cookie is present', async () => {
    const res = await callDelete({ confirmation: USER_PHONE }, { authed: false });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/account/delete — confirmation gate', () => {
  test('400 confirmation_mismatch when body.confirmation does not equal the authed phone', async () => {
    const res = await callDelete({ confirmation: '393909999999' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('confirmation_mismatch');
    // The user row must NOT be touched when confirmation fails.
    const userInstanceCall = mockSupa.calls.find(c => c.table === 'user_instances' && c.operation === 'delete');
    expect(userInstanceCall).toBeUndefined();
  });
});

describe('POST /api/account/delete — cascade happy path (smoke)', () => {
  test('200 ok with deleted_tables and phone_hash in the response body', async () => {
    mockUserInstanceLookup();
    fetchMock.setJsonResponse('/instance/logout/', { ok: true });

    const res = await callDelete({ confirmation: USER_PHONE });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.phone_hash).toMatch(/^h:[0-9a-f]{8}$/);
    // All 10 tables in the cascade (7 looped + rate_limit_state + audit_events + user_instances).
    expect(body.deleted_tables).toEqual(expect.arrayContaining([
      'scheduled_messages',
      'whatsapp_contacts',
      'user_templates',
      'contact_label_assignments',
      'contact_labels',
      'pending_contacts',
      'pending_auth_sessions',
      'rate_limit_state',
      'audit_events',
      'user_instances',
    ]));
    expect(body.evolution_disconnected).toBe(true);
  });
});

describe('POST /api/account/delete — cascade ordering', () => {
  test('audit_events is deleted BEFORE the account_deleted insert, and user_instances delete is LAST', async () => {
    mockUserInstanceLookup();
    await callDelete({ confirmation: USER_PHONE });

    const ops = mockSupa.calls.map(c => ({ table: c.table, op: c.operation }));
    const auditDeleteIdx = ops.findIndex(o => o.table === 'audit_events' && o.op === 'delete');
    const auditInsertIdx = ops.findIndex(o => o.table === 'audit_events' && o.op === 'insert');
    const userInstancesDeleteIdx = ops.findIndex(o => o.table === 'user_instances' && o.op === 'delete');

    expect(auditDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(auditInsertIdx).toBeGreaterThan(auditDeleteIdx);

    // No DB write must happen after the user_instances delete except the
    // final account_deleted audit insert.
    const writesAfterUserInstances = ops
      .slice(userInstancesDeleteIdx + 1)
      .filter(o => o.op === 'delete' || o.op === 'update' || o.op === 'insert');
    expect(writesAfterUserInstances).toEqual([{ table: 'audit_events', op: 'insert' }]);
  });
});

describe('POST /api/account/delete — final audit event', () => {
  test('writes audit_events row with event_type=account_deleted and phone_hash payload', async () => {
    mockUserInstanceLookup();
    await callDelete({ confirmation: USER_PHONE });

    const finalInsert = mockSupa.calls
      .filter(c => c.table === 'audit_events' && c.operation === 'insert')
      .pop()!;
    expect(finalInsert).toBeDefined();
    const row = finalInsert.args[0];
    expect(row.event_type).toBe('account_deleted');
    // user_phone column is null — the user no longer exists.
    expect(row.user_phone).toBeNull();
    expect(row.payload.phone_hash).toMatch(/^h:[0-9a-f]{8}$/);
    expect(Array.isArray(row.payload.deleted_tables)).toBe(true);
    expect(typeof row.payload.evolution_disconnected).toBe('boolean');
  });
});

describe('POST /api/account/delete — Evolution disconnect is best-effort', () => {
  test('returns 200 even when Evolution logout throws, with evolution_disconnected=false', async () => {
    mockUserInstanceLookup();
    fetchMock.setHandler('/instance/logout/', () => {
      throw new Error('Evolution unreachable');
    });

    const res = await callDelete({ confirmation: USER_PHONE });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.evolution_disconnected).toBe(false);
    // DB cascade still completes — user_instances delete was issued.
    const userInstancesDelete = mockSupa.calls.find(c => c.table === 'user_instances' && c.operation === 'delete');
    expect(userInstancesDelete).toBeDefined();
  });
});
