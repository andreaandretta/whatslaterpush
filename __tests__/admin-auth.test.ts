/**
 * Unit tests for the requireAdmin helper.
 * Covers fail-closed when ADMIN_PHONES is unset, 401 when no/invalid cookie,
 * 403 when phone is not allowlisted, and the success path returning
 * AdminContext for an allowlisted phone.
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

function makeReq(cookieValue: string | null) {
  const headers: any = {};
  if (cookieValue) headers.cookie = `sw_session=${cookieValue}`;
  const req = new Request('http://localhost/api/admin/data', { method: 'GET', headers });
  const cookieMap = new Map<string, string>();
  if (cookieValue) cookieMap.set('sw_session', cookieValue);
  (req as any).cookies = {
    get: (n: string) => (cookieMap.has(n) ? { value: cookieMap.get(n) } : undefined),
  };
  return req;
}

describe('requireAdmin', () => {
  test('fail-closed: ADMIN_PHONES unset → 403 (even if cookie is valid)', async () => {
    jest.resetModules();
    delete process.env.ADMIN_PHONES;
    const { requireAdmin, __resetAdminAuthWarnLatch } = await import('../app/lib/admin-auth');
    __resetAdminAuthWarnLatch();
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const res = await requireAdmin(makeReq(cookie) as any);
    expect((res as Response).status).toBe(403);
  });

  test('fail-closed: ADMIN_PHONES empty string → 403', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '   ';
    const { requireAdmin, __resetAdminAuthWarnLatch } = await import('../app/lib/admin-auth');
    __resetAdminAuthWarnLatch();
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const res = await requireAdmin(makeReq(cookie) as any);
    expect((res as Response).status).toBe(403);
  });

  test('returns 401 when no sw_session cookie', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393331234567';
    const { requireAdmin } = await import('../app/lib/admin-auth');
    const res = await requireAdmin(makeReq(null) as any);
    expect((res as Response).status).toBe(401);
  });

  test('returns 401 when cookie is tampered/invalid', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393331234567';
    const { requireAdmin } = await import('../app/lib/admin-auth');
    const res = await requireAdmin(makeReq('garbage.notavalidsig') as any);
    expect((res as Response).status).toBe(401);
  });

  test('returns 403 when cookie is valid but phone not in ADMIN_PHONES', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393339999999';
    const { requireAdmin } = await import('../app/lib/admin-auth');
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const res = await requireAdmin(makeReq(cookie) as any);
    expect((res as Response).status).toBe(403);
  });

  test('returns AdminContext when phone is in ADMIN_PHONES', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = '393331234567,393339999999';
    const { requireAdmin } = await import('../app/lib/admin-auth');
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const res = await requireAdmin(makeReq(cookie) as any);
    expect((res as any).phone).toBe('393331234567');
    expect((res as any).instanceName).toBe('SchedWhats-393331234567');
  });

  test('CSV with whitespace around entries still matches', async () => {
    jest.resetModules();
    process.env.ADMIN_PHONES = ' 393331234567 ,  393339999999  ';
    const { requireAdmin } = await import('../app/lib/admin-auth');
    const cookie = await signCookie({ phone: '393339999999', instanceName: 'SchedWhats-393339999999' });
    const res = await requireAdmin(makeReq(cookie) as any);
    expect((res as any).phone).toBe('393339999999');
  });
});
