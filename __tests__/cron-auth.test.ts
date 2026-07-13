/**
 * #4: the collateral cron GET handlers (daily-report, cleanup-media,
 * cleanup-webhook-logs) must accept the CRON_SECRET via the
 * `Authorization: Bearer` header that Vercel Cron sends — not only via
 * ?secret=. Without this they 401 on every scheduled Vercel Cron invocation
 * (confirmed in prod: daily-report 401×7/week). send-messages already accepts
 * both; these three must match it.
 */
import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CRON_SECRET: 'test-cron',
  };
  // Any post-auth work (daily-report hits Stripe/WhatsApp) resolves benignly —
  // these tests only assert the AUTH decision, not the cron's business logic.
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({}), text: async () => '{}', headers: new Headers(),
  });
});
afterEach(() => { process.env = ORIGINAL_ENV; });

function makeReq(path: string, opts: { bearer?: string; query?: string } = {}) {
  const url = 'https://whatslaterpush.vercel.app' + path + (opts.query ?? '');
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = 'Bearer ' + opts.bearer;
  return { url, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as any;
}

const ROUTES = [
  { name: 'daily-report', path: '/api/cron/daily-report', mod: '../app/api/cron/daily-report/route' },
  { name: 'cleanup-media', path: '/api/cron/cleanup-media', mod: '../app/api/cron/cleanup-media/route' },
  { name: 'cleanup-webhook-logs', path: '/api/cron/cleanup-webhook-logs', mod: '../app/api/cron/cleanup-webhook-logs/route' },
];

describe('#4 collateral cron auth — accepts the Vercel Cron Bearer header', () => {
  for (const r of ROUTES) {
    test(`${r.name}: authorizes Authorization: Bearer <CRON_SECRET> (no query secret)`, async () => {
      const { GET } = await import(r.mod);
      const res = await GET(makeReq(r.path, { bearer: 'test-cron' }));
      expect(res.status).not.toBe(401);
    });

    test(`${r.name}: still accepts the legacy ?secret= query`, async () => {
      const { GET } = await import(r.mod);
      const res = await GET(makeReq(r.path, { query: '?secret=test-cron' }));
      expect(res.status).not.toBe(401);
    });

    test(`${r.name}: rejects a wrong secret with 401`, async () => {
      const { GET } = await import(r.mod);
      const res = await GET(makeReq(r.path, { bearer: 'wrong' }));
      expect(res.status).toBe(401);
    });
  }
});
