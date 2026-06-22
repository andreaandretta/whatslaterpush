/**
 * Integration tests for POST /api/contacts/import.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function authedReq(body: any) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const cookies: Record<string, string> = {};
  cookies[AUTH_COOKIE_NAME] = await signCookie({ phone: USER_PHONE, instanceName: 'X' });
  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  req.cookies = { get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) };
  return req;
}

describe('POST /api/contacts/import', () => {
  test('401 when no cookie', async () => {
    const { POST } = await import('../app/api/contacts/import/route');
    const req: any = mockRequest({ rows: [] });
    req.cookies = { get: () => undefined };
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('400 invalid_body when rows is not array', async () => {
    const req = await authedReq({ rows: 'not an array' });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
  });

  test('400 empty_input when rows is empty array', async () => {
    const req = await authedReq({ rows: [] });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('empty_input');
  });

  test('400 too_many_rows over 1000', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ name: 'X', phone: '393331234567' }));
    const req = await authedReq({ rows });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('too_many_rows');
    expect(body.limit).toBe(1000);
  });

  test('skips invalid phones with row-level errors but imports valid ones', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', []); // no existing dups
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 2);
    const req = await authedReq({
      rows: [
        { name: 'Anna', phone: '393401234567' },   // valid
        { name: 'Bad',  phone: 'garbage' },        // invalid → error row 1
        { name: 'Luca', phone: '393501234567' },   // valid
      ],
    });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.errors.length).toBe(1);
    expect(body.errors[0].row).toBe(1);
  });

  test('rejects rows that equal the authed user_phone (self_target)', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', []);
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 0);
    const req = await authedReq({
      rows: [{ name: 'Me', phone: USER_PHONE }],
    });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(0);
    expect(body.errors[0].error).toBe('self_target');
  });

  test('reports skipped_duplicates for numbers already in whatsapp_contacts', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393401234567' }, // already present
    ]);
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 2);
    const req = await authedReq({
      rows: [
        { name: 'Anna', phone: '393401234567' }, // duplicate
        { name: 'New',  phone: '393502222222' }, // new
      ],
    });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    const body = await res.json();
    expect(body.imported).toBe(2); // both upserted (RPC handles dedup)
    expect(body.skipped_duplicates).toBe(1); // but reported as previously-existing
  });

  test('RPC error surfaces as 500', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', []);
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', null, { message: 'rpc broken' });
    const req = await authedReq({
      rows: [{ name: 'X', phone: '393401234567' }],
    });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  test('H9: caps new contacts at the per-user ceiling and reports capped', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', [], null, { count: 4998 }); // near ceiling, no dups
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 2);
    const req = await authedReq({
      rows: [
        { name: 'A', phone: '393401111111' },
        { name: 'B', phone: '393402222222' },
        { name: 'C', phone: '393403333333' },
      ],
    });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2); // only 5000-4998 = 2 fit
    expect(body.capped).toBe(1);
  });

  test('H9: 409 contact_limit_reached when already at the ceiling and the import has new rows', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', [], null, { count: 5000 });
    const req = await authedReq({ rows: [{ name: 'A', phone: '393401111111' }] });
    const { POST } = await import('../app/api/contacts/import/route');
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('contact_limit_reached');
    expect(body.limit).toBe(5000);
  });
});
