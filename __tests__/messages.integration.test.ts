import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase } from './helpers/mocks';

const SECRET = '0'.repeat(128);
const mockSupa = createMockSupabase();
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: SECRET,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function reqWithCookie(method: string, url: string, cookieValue: string | null, body?: any) {
  const headers: any = { 'content-type': 'application/json' };
  if (cookieValue) headers.cookie = `sw_session=${cookieValue}`;
  const req = new Request(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
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

describe('GET /api/messages', () => {
  test('returns 401 without cookie', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    const { GET } = await import('../app/api/messages/route');
    const res = await GET(reqWithCookie('GET', 'http://localhost/api/messages', null) as any);
    expect(res.status).toBe(401);
  });

  test('returns messages for cookie phone', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.AUTH_COOKIE_SECRET = SECRET;
    mockSupa.setResponse('user_instances:select', { id: 'u1', subscription_plan: 'free', trial_ends_at: null, connection_status: 'open' }, null);
    mockSupa.setResponse('scheduled_messages:select', [{ id: 'm1', recipient_name: 'Mario' }], null);
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { GET } = await import('../app/api/messages/route');
    const res = await GET(reqWithCookie('GET', 'http://localhost/api/messages', cookie) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

describe('DELETE /api/messages', () => {
  test('returns 401 without cookie', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(reqWithCookie('DELETE', 'http://localhost/api/messages', null, { id: 'm1' }) as any);
    expect(res.status).toBe(401);
  });

  test('deletes only when message belongs to cookie phone', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.AUTH_COOKIE_SECRET = SECRET;
    mockSupa.setResponse('scheduled_messages:select', { id: 'm1', instance_phone: '393331234567' }, null);
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'm1' }], null);
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(reqWithCookie('DELETE', 'http://localhost/api/messages', cookie, { id: 'm1' }) as any);
    expect(res.status).toBe(200);
  });
});
