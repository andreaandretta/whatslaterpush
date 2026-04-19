/**
 * Integration tests for cookie auth flow (/api/auth/*).
 */
import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const SECRET = '0'.repeat(128);
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: SECRET,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    NEXT_PUBLIC_APP_URL: 'https://whatslaterpush.vercel.app',
  };
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makeReqWithCookie(method: string, cookieValue: string | null) {
  const headers: any = {};
  if (cookieValue) headers.cookie = `sw_session=${cookieValue}`;
  const req = new Request('http://localhost/api/auth/me', { method, headers });

  // Mock the cookies property that NextRequest provides
  const cookieMap = new Map<string, string>();
  if (cookieValue) {
    cookieMap.set('sw_session', cookieValue);
  }

  (req as any).cookies = {
    get: (name: string) => cookieMap.has(name) ? { value: cookieMap.get(name) } : undefined,
  };

  return req;
}

describe('POST /api/auth/init', () => {
  test('returns 400 if phone missing', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const req = new Request('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('returns 400 if phone invalid', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const req = new Request('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({ phone: 'abc' }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('on success creates pending session and returns sessionId+QR/pairing', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    // Mock Evolution API to return qrcode in /instance/create response
    fetchMock.setHandler('/instance/create', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ qrcode: { base64: 'data:image/png;base64,FAKEQR', pairingCode: 'ABCD-1234' } }),
      text: async () => '{}',
    }));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const req = new Request('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({ phone: '393331234567' }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.qrCode).toBeTruthy();
    expect(body.pairingCode).toBeTruthy();
    // pending_auth_sessions insert should have happened
    const insertCall = mockSupa.calls.find(c => c.table === 'pending_auth_sessions' && c.operation === 'insert');
    expect(insertCall).toBeTruthy();
  });
});

describe('GET /api/auth/me', () => {
  test('returns 401 when no cookie present', async () => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = SECRET;
    const { GET } = await import('../app/api/auth/me/route');
    const res = await GET(makeReqWithCookie('GET', null) as any);
    expect(res.status).toBe(401);
  });

  test('returns phone+instanceName when cookie valid', async () => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = SECRET;
    const cookie = signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { GET } = await import('../app/api/auth/me/route');
    const res = await GET(makeReqWithCookie('GET', cookie) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phone).toBe('393331234567');
    expect(body.instanceName).toBe('SchedWhats-393331234567');
  });

  test('returns 401 when cookie tampered', async () => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = SECRET;
    const cookie = signCookie({ phone: '393331234567', instanceName: 'X' });
    const tampered = cookie.slice(0, -2) + 'AA';
    const { GET } = await import('../app/api/auth/me/route');
    const res = await GET(makeReqWithCookie('GET', tampered) as any);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  test('returns 200 and Set-Cookie clearing the session', async () => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = SECRET;
    const { POST } = await import('../app/api/auth/logout/route');
    const req = new Request('http://localhost/api/auth/logout', { method: 'POST' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/sw_session=/);
    expect(setCookie.toLowerCase()).toContain('max-age=0');
    expect(setCookie.toLowerCase()).toContain('httponly');
  });
});

describe('GET /api/auth/check', () => {
  test('returns 400 if sessionId missing', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    const { GET } = await import('../app/api/auth/check/route');
    const req = new Request('http://localhost/api/auth/check', { method: 'GET' });
    const res = await GET(req as any);
    expect(res.status).toBe(400);
  });

  test('returns 410 if session not found or expired', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('pending_auth_sessions:select', null, null);
    const { GET } = await import('../app/api/auth/check/route');
    const req = new Request('http://localhost/api/auth/check?sessionId=missing-id', { method: 'GET' });
    const res = await GET(req as any);
    expect(res.status).toBe(410);
  });

  test('returns 200 authenticated:false when status pending', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('pending_auth_sessions:select',
      { id: 'sess-1', phone: '393331234567', status: 'pending', instance_name: null, expires_at: new Date(Date.now() + 60000).toISOString() },
      null,
    );
    const { GET } = await import('../app/api/auth/check/route');
    const req = new Request('http://localhost/api/auth/check?sessionId=sess-1', { method: 'GET' });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
  });

  test('returns 200 authenticated:true + Set-Cookie when authenticated', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.AUTH_COOKIE_SECRET = SECRET;
    mockSupa.setResponse('pending_auth_sessions:select',
      { id: 'sess-1', phone: '393331234567', status: 'authenticated', instance_name: 'SchedWhats-393331234567', expires_at: new Date(Date.now() + 60000).toISOString() },
      null,
    );
    const { GET } = await import('../app/api/auth/check/route');
    const req = new Request('http://localhost/api/auth/check?sessionId=sess-1', { method: 'GET' });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/sw_session=/);
    expect(setCookie.toLowerCase()).toContain('httponly');
    const deleteCall = mockSupa.calls.find(c => c.table === 'pending_auth_sessions' && c.operation === 'delete');
    expect(deleteCall).toBeTruthy();
  });
});
