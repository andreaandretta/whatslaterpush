/**
 * Integration tests for the admin gate in middleware.ts.
 * Covers /admin (page) and /api/admin/data (cookie-protected API) under the
 * four cookie/allowlist combinations, plus the fail-closed path when
 * ADMIN_PHONES is unset. Verifies that the legacy MONITORING_SECRET-only
 * endpoints under /api/admin/* (contacts-stats, backfill-photos) are NOT
 * intercepted by the new gate — they keep their existing handler-level guard.
 */
import { signCookie } from '../app/lib/auth-cookie';

const SECRET = '0'.repeat(128);
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: SECRET,
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makeReq(pathname: string, cookieValue: string | null) {
  const url = `http://localhost${pathname}`;
  const headers: any = {};
  if (cookieValue) headers.cookie = `sw_session=${cookieValue}`;
  const req: any = new Request(url, { method: 'GET', headers });

  // NextRequest exposes `cookies` and `nextUrl.clone()`. Minimal mocks
  // sufficient for the middleware paths we exercise here.
  const cookieMap = new Map<string, string>();
  if (cookieValue) cookieMap.set('sw_session', cookieValue);
  req.cookies = {
    get: (n: string) => (cookieMap.has(n) ? { value: cookieMap.get(n) } : undefined),
  };
  const parsed = new URL(url);
  req.nextUrl = {
    pathname: parsed.pathname,
    search: parsed.search,
    clone: () => {
      const u: any = new URL(parsed.toString());
      return u;
    },
  };
  return req;
}

describe('middleware admin gate', () => {
  test('/admin without sw_session → 404 (fail-closed allowlist missing)', async () => {
    jest.resetModules();
    delete process.env.ADMIN_PHONES;
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq('/admin', null));
    expect(res.status).toBe(404);
  });

  test('/admin with valid sw_session but ADMIN_PHONES unset → 404', async () => {
    jest.resetModules();
    delete process.env.ADMIN_PHONES;
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq('/admin', cookie));
    expect(res.status).toBe(404);
  });

  test('/admin with sw_session for non-allowlisted phone → 404', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393339999999';
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq('/admin', cookie));
    expect(res.status).toBe(404);
  });

  test('/admin with allowlisted sw_session → passes through (NextResponse.next)', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393331234567';
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq('/admin', cookie));
    // NextResponse.next() yields a 200 by default. Anything other than 404/403
    // indicates the admin gate let the request through.
    expect(res.status).toBe(200);
  });

  test('/api/admin/data without cookie → 401', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393331234567';
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq('/api/admin/data', null));
    expect(res.status).toBe(401);
  });

  test('/api/admin/data with non-allowlisted phone → 403', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393339999999';
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq('/api/admin/data', cookie));
    expect(res.status).toBe(403);
  });

  test('/api/admin/data with allowlisted phone → passes through', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393331234567';
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq('/api/admin/data', cookie));
    expect(res.status).toBe(200);
  });

  test('legacy /api/admin/contacts-stats is NOT intercepted by admin gate', async () => {
    // Handler-level MONITORING_SECRET guard stays in charge for the 2 endpoints
    // not on the cookie-protected list. Middleware passes through as a public
    // prefix; no 401/403/404 from the admin gate path.
    jest.resetModules();
    delete process.env.ADMIN_PHONES; // even fail-closed shouldn't block these
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq('/api/admin/contacts-stats', null));
    expect(res.status).toBe(200);
  });
});
