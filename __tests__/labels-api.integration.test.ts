/**
 * Integration tests for /api/labels and /api/labels/:id/contacts* routes.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';
const INSTANCE = 'SchedWhats-' + USER_PHONE;

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

async function authedReq(body: any = {}) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const cookies: Record<string, string> = {};
  const value = await signCookie({ phone: USER_PHONE, instanceName: INSTANCE });
  cookies[AUTH_COOKIE_NAME] = value;
  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  req.cookies = { get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) };
  req.url = 'https://whatslaterpush.vercel.app/api/labels';
  return req;
}

describe('GET /api/labels', () => {
  test('401 when no cookie', async () => {
    const { GET } = await import('../app/api/labels/route');
    const req: any = mockRequest({});
    req.cookies = { get: () => undefined };
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test('lists user labels with contact_count attached', async () => {
    mockSupa.setResponse('contact_labels:select', [
      { id: 'L1', name: 'U12', color: '#25D366', display_order: 0, created_at: '' },
      { id: 'L2', name: 'Genitori', color: '#FF6B6B', display_order: 1, created_at: '' },
    ]);
    mockSupa.setResponse('contact_label_assignments:select', [
      { label_id: 'L1' }, { label_id: 'L1' }, { label_id: 'L2' },
    ]);
    const req = await authedReq();
    const { GET } = await import('../app/api/labels/route');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.labels).toHaveLength(2);
    expect(body.labels[0].contact_count).toBe(2);
    expect(body.labels[1].contact_count).toBe(1);
  });
});

describe('POST /api/labels', () => {
  test('400 invalid_name when empty', async () => {
    const req = await authedReq({ name: '   ' });
    const { POST } = await import('../app/api/labels/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_name');
  });

  test('200 creates label with cleaned name + color', async () => {
    mockSupa.setResponse('contact_labels:insert', {
      id: 'L-new', name: 'Fornitori', color: '#FF6B6B', display_order: 0, created_at: '',
    });
    const req = await authedReq({ name: 'Fornitori', color: '#FF6B6B' });
    const { POST } = await import('../app/api/labels/route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.label.name).toBe('Fornitori');
    expect(body.label.color).toBe('#FF6B6B');
    expect(body.label.contact_count).toBe(0);
  });

  test('200 falls back to default color when format invalid', async () => {
    mockSupa.setResponse('contact_labels:insert', {
      id: 'L-c', name: 'X', color: '#25D366', display_order: 0, created_at: '',
    });
    const req = await authedReq({ name: 'X', color: 'rebeccapurple' });
    const { POST } = await import('../app/api/labels/route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Verify the INSERT got the fallback color, not the invalid input.
    const insertCall = mockSupa.calls.find(c => c.table === 'contact_labels' && c.operation === 'insert');
    expect(insertCall!.args[0].color).toBe('#25D366');
  });

  test('409 on duplicate name (Postgres 23505)', async () => {
    mockSupa.setResponse('contact_labels:insert', null, { code: '23505', message: 'duplicate' });
    const req = await authedReq({ name: 'U12' });
    const { POST } = await import('../app/api/labels/route');
    const res = await POST(req);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('duplicate_name');
  });
});

describe('DELETE /api/labels/:id', () => {
  test('404 when label not owned by user (no rows matched)', async () => {
    mockSupa.setResponse('contact_labels:delete', []);
    const req = await authedReq();
    const { DELETE } = await import('../app/api/labels/[id]/route');
    const res = await DELETE(req, { params: { id: 'other-user-label' } });
    expect(res.status).toBe(404);
  });

  test('200 when label deleted (cascade handled by FK)', async () => {
    mockSupa.setResponse('contact_labels:delete', [{ id: 'L1' }]);
    const req = await authedReq();
    const { DELETE } = await import('../app/api/labels/[id]/route');
    const res = await DELETE(req, { params: { id: 'L1' } });
    expect(res.status).toBe(200);
    // Confirm the DELETE was scoped to (id, user_phone) — ownership guard.
    const delCall = mockSupa.calls.find(c => c.table === 'contact_labels' && c.operation === 'delete');
    const userPhoneEq = delCall!.chain.find(c => c.method === 'eq' && c.args[0] === 'user_phone');
    expect(userPhoneEq?.args[1]).toBe(USER_PHONE);
  });
});

describe('POST /api/labels/:id/contacts', () => {
  test('400 invalid_phone for non-E.164 input', async () => {
    const req = await authedReq({ contact_number: 'not-a-number' });
    const { POST } = await import('../app/api/labels/[id]/contacts/route');
    const res = await POST(req, { params: { id: 'L1' } });
    expect(res.status).toBe(400);
  });

  test('404 when label not owned', async () => {
    mockSupa.setResponse('contact_labels:select', null);
    const req = await authedReq({ contact_number: '393401234567' });
    const { POST } = await import('../app/api/labels/[id]/contacts/route');
    const res = await POST(req, { params: { id: 'L-other' } });
    expect(res.status).toBe(404);
  });

  test('200 idempotent upsert when label owned + valid phone', async () => {
    mockSupa.setResponse('contact_labels:select', { id: 'L1' });
    mockSupa.setResponse('contact_label_assignments:upsert', null);
    const req = await authedReq({ contact_number: '393401234567' });
    const { POST } = await import('../app/api/labels/[id]/contacts/route');
    const res = await POST(req, { params: { id: 'L1' } });
    expect(res.status).toBe(200);
    const upCall = mockSupa.calls.find(c => c.table === 'contact_label_assignments' && c.operation === 'upsert');
    expect(upCall!.args[0]).toMatchObject({
      label_id: 'L1', user_phone: USER_PHONE, contact_number: '393401234567',
    });
    expect(upCall!.args[1]).toMatchObject({ onConflict: 'label_id,contact_number', ignoreDuplicates: true });
  });
});

describe('DELETE /api/labels/:id/contacts/:number', () => {
  test('404 when assignment not found', async () => {
    mockSupa.setResponse('contact_label_assignments:delete', []);
    const req = await authedReq();
    const { DELETE } = await import('../app/api/labels/[id]/contacts/[number]/route');
    const res = await DELETE(req, { params: { id: 'L1', number: '393401234567' } });
    expect(res.status).toBe(404);
  });

  test('200 when assignment removed', async () => {
    mockSupa.setResponse('contact_label_assignments:delete', [{ label_id: 'L1' }]);
    const req = await authedReq();
    const { DELETE } = await import('../app/api/labels/[id]/contacts/[number]/route');
    const res = await DELETE(req, { params: { id: 'L1', number: '393401234567' } });
    expect(res.status).toBe(200);
  });
});
