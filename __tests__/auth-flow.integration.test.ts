/**
 * Integration tests for cookie auth flow (/api/auth/*).
 */
import { signCookie } from '../app/lib/auth-cookie';

const SECRET = '0'.repeat(128);
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, AUTH_COOKIE_SECRET: SECRET };
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
