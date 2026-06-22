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
  // Safe defaults (response maps persist across tests): empty media, successful
  // remove + cascade. Individual tests override as needed.
  mockSupa.setStorageResponse('message-media:list', []);
  mockSupa.setStorageResponse('message-media:remove', null);
  mockSupa.setRpcResponse('delete_user_account', null);
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
    expect((await res.json()).error).toBe('confirmation_mismatch');
    // Nothing destructive must run when confirmation fails.
    expect(mockSupa.calls.find(c => c.operation === 'delete_user_account')).toBeUndefined();
    expect(mockSupa.calls.find(c => c.table === 'storage:message-media')).toBeUndefined();
  });
});

describe('POST /api/account/delete — happy path', () => {
  test('200 ok: purges media, runs the atomic RPC cascade, returns removed_media + phone_hash', async () => {
    mockUserInstanceLookup();
    mockSupa.setStorageResponse('message-media:list', [{ name: 'a.jpg' }, { name: 'b.png' }]);
    mockSupa.setRpcResponse('delete_user_account', null);
    fetchMock.setJsonResponse('/instance/logout/', { ok: true });

    const res = await callDelete({ confirmation: USER_PHONE });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.phone_hash).toMatch(/^h:[0-9a-f]{8}$/);
    expect(body.removed_media).toBe(2);
    expect(body.evolution_disconnected).toBe(true);
    expect(body.deleted_tables).toBeUndefined(); // replaced by the atomic RPC

    const rpc = mockSupa.calls.find(c => c.operation === 'delete_user_account');
    expect(rpc).toBeDefined();
    expect(rpc!.args[0]).toEqual({ p_phone: USER_PHONE, p_instance_name: INSTANCE });

    const list = mockSupa.calls.find(c => c.table === 'storage:message-media' && c.operation === 'list');
    expect(list!.args[0]).toBe(USER_PHONE);
    const remove = mockSupa.calls.find(c => c.table === 'storage:message-media' && c.operation === 'remove');
    expect(remove!.args[0]).toEqual([USER_PHONE + '/a.jpg', USER_PHONE + '/b.png']);
  });

  test('no media: removed_media=0, no remove call, RPC still runs', async () => {
    mockUserInstanceLookup();
    mockSupa.setStorageResponse('message-media:list', []);
    mockSupa.setRpcResponse('delete_user_account', null);
    const res = await callDelete({ confirmation: USER_PHONE });
    const body = await res.json();
    expect(body.removed_media).toBe(0);
    expect(mockSupa.calls.find(c => c.table === 'storage:message-media' && c.operation === 'remove')).toBeUndefined();
    expect(mockSupa.calls.find(c => c.operation === 'delete_user_account')).toBeDefined();
  });
});

describe('POST /api/account/delete — storage-first, abort on failure (no half-delete)', () => {
  test('500 storage_purge_failed on remove error, and the DB cascade RPC is NOT called', async () => {
    mockUserInstanceLookup();
    mockSupa.setStorageResponse('message-media:list', [{ name: 'a.jpg' }]);
    mockSupa.setStorageResponse('message-media:remove', null, { message: 'storage down' });

    const res = await callDelete({ confirmation: USER_PHONE });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('storage_purge_failed');
    expect(mockSupa.calls.find(c => c.operation === 'delete_user_account')).toBeUndefined(); // nothing deleted
  });
});

describe('POST /api/account/delete — RPC cascade error', () => {
  test('500 cascade_failed when the transactional RPC errors', async () => {
    mockUserInstanceLookup();
    mockSupa.setStorageResponse('message-media:list', []);
    mockSupa.setRpcResponse('delete_user_account', null, { message: 'tx aborted' });
    const res = await callDelete({ confirmation: USER_PHONE });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('cascade_failed');
  });
});

describe('POST /api/account/delete — final audit event', () => {
  test('account_deleted: user_phone null, phone_hash + removed_media payload, NO ip_address (GDPR), after the RPC', async () => {
    mockUserInstanceLookup();
    mockSupa.setStorageResponse('message-media:list', [{ name: 'a.jpg' }]);
    mockSupa.setRpcResponse('delete_user_account', null);
    await callDelete({ confirmation: USER_PHONE });

    const finalInsert = mockSupa.calls
      .filter(c => c.table === 'audit_events' && c.operation === 'insert')
      .pop()!;
    expect(finalInsert).toBeDefined();
    const row = finalInsert.args[0];
    expect(row.event_type).toBe('account_deleted');
    expect(row.user_phone).toBeNull();
    expect(row.payload.phone_hash).toMatch(/^h:[0-9a-f]{8}$/);
    expect(row.payload.removed_media).toBe(1);
    expect(row.payload).not.toHaveProperty('deleted_tables');
    // GDPR: the deletion record must not store the requester IP.
    expect(row.ip_address).toBeFalsy();
    expect(row.payload).not.toHaveProperty('ip_address');

    // Forensic event written AFTER the cascade RPC.
    const rpcIdx = mockSupa.calls.findIndex(c => c.operation === 'delete_user_account');
    const auditInsertIdx = mockSupa.calls.findIndex(c => c.table === 'audit_events' && c.operation === 'insert');
    expect(rpcIdx).toBeGreaterThanOrEqual(0);
    expect(auditInsertIdx).toBeGreaterThan(rpcIdx);
  });
});

describe('POST /api/account/delete — Evolution disconnect is best-effort', () => {
  test('200 even when Evolution logout throws, with evolution_disconnected=false; DB cascade still ran', async () => {
    mockUserInstanceLookup();
    mockSupa.setStorageResponse('message-media:list', []);
    mockSupa.setRpcResponse('delete_user_account', null);
    fetchMock.setHandler('/instance/logout/', () => { throw new Error('Evolution unreachable'); });

    const res = await callDelete({ confirmation: USER_PHONE });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.evolution_disconnected).toBe(false);
    expect(mockSupa.calls.find(c => c.operation === 'delete_user_account')).toBeDefined();
  });
});
