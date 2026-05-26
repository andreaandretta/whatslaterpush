/**
 * Integration tests for /api/templates and /api/templates/personal* routes.
 * Mocks Supabase + verifyCookie.
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
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function authedRequest(body: any = {}, opts: { method?: string } = {}) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

  const cookies: Record<string, string> = {};
  const value = await signCookie({ phone: USER_PHONE, instanceName: INSTANCE });
  cookies[AUTH_COOKIE_NAME] = value;

  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  req.cookies = {
    get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined),
  };
  req.url = 'https://whatslaterpush.vercel.app/api/templates';
  return req;
}

describe('GET /api/templates (seed)', () => {
  test('401 when no session cookie', async () => {
    jest.resetModules();
    const { GET } = await import('../app/api/templates/route');
    const req: any = mockRequest({});
    req.cookies = { get: () => undefined };
    req.url = 'https://whatslaterpush.vercel.app/api/templates';
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test('returns seed templates filtered by category', async () => {
    mockSupa.setResponse('message_templates:select', [
      { id: 't1', category: 'allenatore', title: 'Convocazione', body: '...', emoji: '🏃', variables: [], display_order: 1, is_beta: true },
    ]);
    const req = await authedRequest();
    req.url = 'https://whatslaterpush.vercel.app/api/templates?category=allenatore';
    const { GET } = await import('../app/api/templates/route');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].category).toBe('allenatore');
  });
});

describe('GET /api/templates/personal', () => {
  test('401 when no session cookie', async () => {
    jest.resetModules();
    const { GET } = await import('../app/api/templates/personal/route');
    const req: any = mockRequest({});
    req.cookies = { get: () => undefined };
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test('returns user templates ordered by use_count desc', async () => {
    mockSupa.setResponse('user_templates:select', [
      { id: 'u1', title: 'Most used', body: '...', use_count: 5, emoji: '⭐', category: null, source_template_id: null, created_at: '', updated_at: '' },
      { id: 'u2', title: 'Less used', body: '...', use_count: 1, emoji: '⭐', category: null, source_template_id: null, created_at: '', updated_at: '' },
    ]);
    const req = await authedRequest();
    const { GET } = await import('../app/api/templates/personal/route');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toHaveLength(2);
    expect(body.templates[0].use_count).toBe(5);
  });
});

describe('POST /api/templates/personal', () => {
  test('400 invalid_title when missing', async () => {
    const req = await authedRequest({ body: 'some body' });
    const { POST } = await import('../app/api/templates/personal/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_title');
  });

  test('400 invalid_body when empty body', async () => {
    const req = await authedRequest({ title: 'Mio template', body: '   ' });
    const { POST } = await import('../app/api/templates/personal/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_body');
  });

  test('200 inserts a new template with source_template_id', async () => {
    // Explicit null on select to override any prior test's leaked response.
    mockSupa.setResponse('user_templates:select', null);
    mockSupa.setResponse('user_templates:insert', {
      id: 'new-id', title: 'Convocazione martedì', body: 'Allenamento martedì 18:00',
      source_template_id: 'seed-1', use_count: 0, emoji: null, category: null,
      created_at: '', updated_at: '',
    });
    const req = await authedRequest({
      title: 'Convocazione martedì',
      body: 'Allenamento martedì 18:00',
      source_template_id: 'seed-1',
    });
    const { POST } = await import('../app/api/templates/personal/route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deduped).toBe(false);
    expect(body.template.title).toBe('Convocazione martedì');

    const insertCall = mockSupa.calls.find(c => c.table === 'user_templates' && c.operation === 'insert');
    expect(insertCall).toBeDefined();
    expect(insertCall!.args[0].user_phone).toBe(USER_PHONE);
    expect(insertCall!.args[0].source_template_id).toBe('seed-1');
  });

  test('200 deduped=true when identical body already exists', async () => {
    mockSupa.setResponse('user_templates:select', [
      { id: 'existing', title: 'Esistente', body: 'Allenamento martedì 18:00', use_count: 3, emoji: null, category: null, source_template_id: null, created_at: '', updated_at: '' },
    ]);
    const req = await authedRequest({
      title: 'Nuovo (ma duplicato)',
      body: 'Allenamento martedì 18:00',
    });
    const { POST } = await import('../app/api/templates/personal/route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deduped).toBe(true);
    expect(body.template.id).toBe('existing');
  });
});

describe('POST /api/templates/personal/:id/use', () => {
  test('404 when template not owned by user', async () => {
    // mock select returns null (no row found) → ownership check fails
    mockSupa.setResponse('user_templates:select', null);
    const req = await authedRequest();
    const { POST } = await import('../app/api/templates/personal/[id]/use/route');
    const res = await POST(req, { params: { id: 'someone-elses-id' } });
    expect(res.status).toBe(404);
  });

  test('200 increments use_count via RPC when owned', async () => {
    mockSupa.setResponse('user_templates:select', [
      { id: 'owned-id' },
    ]);
    mockSupa.setRpcResponse('user_template_increment_use', {
      id: 'owned-id', use_count: 4, title: 'x', body: 'y',
      emoji: null, category: null, source_template_id: null,
      user_phone: USER_PHONE, created_at: '', updated_at: '',
    });
    const req = await authedRequest();
    const { POST } = await import('../app/api/templates/personal/[id]/use/route');
    const res = await POST(req, { params: { id: 'owned-id' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.template.use_count).toBe(4);

    const rpcCall = mockSupa.calls.find(c => c.table === '__rpc__' && c.operation === 'user_template_increment_use');
    expect(rpcCall).toBeDefined();
    expect(rpcCall!.args[0]).toEqual({ p_template_id: 'owned-id' });
  });
});
