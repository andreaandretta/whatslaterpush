/**
 * Unit tests for the shared /api/ops/* auth gate (app/lib/ops-auth.ts).
 *
 * Secrets-fix: header (Authorization: Bearer) is the preferred channel; ?secret=
 * query stays as a DEPRECATED fallback for GET-only server-to-server callers
 * (Cowork Torre, cron pinger) that cannot send custom headers. Either valid
 * channel authorizes; an absent/empty token never does; and a valid header must
 * not be blocked by a stale/wrong query.
 */
import { denyUnlessOpsAuthorized } from '../app/lib/ops-auth';

const SECRET = 'ops-secret-xyz-123';
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, OPS_SECRET: SECRET };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makeReq(opts: { query?: string; auth?: string }): any {
  const base = 'https://whatslaterpush.vercel.app/api/ops/test';
  const url = opts.query !== undefined ? `${base}?secret=${encodeURIComponent(opts.query)}` : base;
  return {
    url,
    headers: { get: (n: string) => (n.toLowerCase() === 'authorization' ? (opts.auth ?? null) : null) },
  };
}

describe('denyUnlessOpsAuthorized', () => {
  test('500 when OPS_SECRET is not configured (fail closed)', () => {
    delete process.env.OPS_SECRET;
    const res = denyUnlessOpsAuthorized(makeReq({ auth: 'Bearer ' + SECRET }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });

  test('401 when neither channel matches', () => {
    expect(denyUnlessOpsAuthorized(makeReq({ query: 'nope', auth: 'Bearer wrong' }))!.status).toBe(401);
  });

  test('authorizes a valid Authorization: Bearer (preferred channel)', () => {
    expect(denyUnlessOpsAuthorized(makeReq({ auth: 'Bearer ' + SECRET }))).toBeNull();
  });

  test('still authorizes a valid ?secret= query (deprecated GET-only fallback — Cowork/cron regression guard)', () => {
    expect(denyUnlessOpsAuthorized(makeReq({ query: SECRET }))).toBeNull();
  });

  test('a valid Bearer header authorizes even when a stale/wrong ?secret= is present (header not blocked by query)', () => {
    expect(denyUnlessOpsAuthorized(makeReq({ query: 'wrong', auth: 'Bearer ' + SECRET }))).toBeNull();
  });

  test('an absent or empty token never authorizes', () => {
    expect(denyUnlessOpsAuthorized(makeReq({}))!.status).toBe(401);
    expect(denyUnlessOpsAuthorized(makeReq({ auth: 'Bearer ' }))!.status).toBe(401);
    expect(denyUnlessOpsAuthorized(makeReq({ query: '' }))!.status).toBe(401);
  });

  test('Bearer scheme match is case-insensitive', () => {
    expect(denyUnlessOpsAuthorized(makeReq({ auth: 'bearer ' + SECRET }))).toBeNull();
  });
});
