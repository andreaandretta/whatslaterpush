/**
 * Integration test for GET /api/admin/tower.
 *
 * Secrets-fix: the Tower aggregates the secret-guarded /api/ops/* proxies via
 * server-side self-fetch. It must pass OPS_SECRET as an Authorization: Bearer
 * header, NOT as a ?secret= query param — so the secret stops landing in the
 * internal-hop URL (and thus in Vercel request logs).
 */
import { createMockSupabase, createFetchMock, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;
const ADMIN_PHONE = '393331234567';
const OPS = 'ops-secret-abc';

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
    ADMIN_PHONES: ADMIN_PHONE,
    OPS_SECRET: OPS,
  };
  (global as any).fetch = fetchMock.mockFetch;
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function callTower() {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  (global as any).fetch = fetchMock.mockFetch;
  const { GET } = await import('../app/api/admin/tower/route');
  const cookieVal = await signCookie({ phone: ADMIN_PHONE, instanceName: 'SchedWhats-' + ADMIN_PHONE });
  const req: any = mockRequest({}, {});
  req.cookies = { get: (n: string) => (n === AUTH_COOKIE_NAME ? { value: cookieVal } : undefined) };
  req.nextUrl = new URL('https://whatslaterpush.vercel.app/api/admin/tower');
  return GET(req);
}

function authOf(headers: any): string | undefined {
  return headers?.Authorization || headers?.authorization;
}

describe('GET /api/admin/tower — OPS_SECRET travels in a header, not the URL', () => {
  test('self-fetches the 3 /api/ops/* proxies with Authorization: Bearer and NO secret in the URL', async () => {
    mockSupa.setRpcResponse('admin_tower_users', []);
    const res = await callTower();
    expect(res.status).toBe(200);

    const opsCalls = fetchMock.calls.filter((c) => c.url.includes('/api/ops/'));
    expect(opsCalls.length).toBe(3);
    for (const c of opsCalls) {
      expect(c.url).not.toContain('secret='); // was ?secret=...; must be gone
      expect(authOf(c.options.headers)).toBe('Bearer ' + OPS);
    }
    // The non-ops /api/health self-fetch carries no auth header.
    const health = fetchMock.calls.find((c) => c.url.includes('/api/health'));
    expect(health).toBeDefined();
    expect(authOf(health!.options.headers)).toBeUndefined();
  });

  test('403 when the caller is authenticated but not an admin (no OPS self-fetch happens)', async () => {
    process.env.ADMIN_PHONES = '399999999999'; // valid cookie, but not in the allowlist
    mockSupa.setRpcResponse('admin_tower_users', []);
    const res = await callTower();
    expect(res.status).toBe(403);
    expect(fetchMock.calls.filter((c) => c.url.includes('/api/ops/')).length).toBe(0);
  });
});
