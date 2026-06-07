/**
 * Integration tests for GET /api/admin/sla.
 * Mocks Supabase with synthetic audit_events + scheduled_messages results.
 *
 * Auth migrated 2026-06-07 from CRON_SECRET (?secret=) to the sw_session
 * cookie + ADMIN_PHONES allowlist (Codex finding #2 fix). Tests now build a
 * signed sw_session for an allowlisted phone.
 */
import { createMockSupabase } from './helpers/mocks';
import { signCookie } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
const AUTH_SECRET = '0'.repeat(128);
const ADMIN_PHONE = '393331234567';

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    AUTH_COOKIE_SECRET: AUTH_SECRET,
    ADMIN_PHONES: ADMIN_PHONE,
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function call(since: string = '', cookieValue: string | null | undefined = 'auto') {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { GET } = await import('../app/api/admin/sla/route');

  const url = since
    ? `https://whatslaterpush.vercel.app/api/admin/sla?since=${since}`
    : 'https://whatslaterpush.vercel.app/api/admin/sla';

  let cookie: string | null;
  if (cookieValue === 'auto') {
    cookie = await signCookie({ phone: ADMIN_PHONE, instanceName: `SchedWhats-${ADMIN_PHONE}` });
  } else {
    cookie = cookieValue;
  }

  const req: any = new Request(url, { method: 'GET' });
  const cookieMap = new Map<string, string>();
  if (cookie) cookieMap.set('sw_session', cookie);
  req.cookies = {
    get: (n: string) => (cookieMap.has(n) ? { value: cookieMap.get(n) } : undefined),
  };
  return GET(req);
}

function makeSentEvent(driftMs: number, dayOffset = 0): { created_at: string; payload: any } {
  const created = new Date(Date.now() - dayOffset * 86400_000);
  return {
    created_at: created.toISOString(),
    payload: { drift_ms: driftMs },
  };
}

describe('GET /api/admin/sla', () => {
  test('401 without sw_session cookie', async () => {
    const res = await call('', null);
    expect(res.status).toBe(401);
  });

  test('zero-events edge case returns 0 percentages, not NaN', async () => {
    mockSupa.setResponse('audit_events:select', []);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.sent).toBe(0);
    expect(body.totals.on_time_pct).toBe(0);
    expect(body.totals.delivery_rate_pct).toBe(0);
    expect(body.totals.read_rate_pct).toBe(0);
    expect(body.daily).toEqual([]);
  });

  test('correct bucket computation for known drift_ms values', async () => {
    // 5 events: 3 on-time (<60s), 1 late (5min), 1 very_late (15min)
    const events = [
      makeSentEvent(500),
      makeSentEvent(1_200),
      makeSentEvent(45_000),
      makeSentEvent(5 * 60_000),
      makeSentEvent(15 * 60_000),
    ];
    mockSupa.setResponse('audit_events:select', events);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });

    const res = await call();
    const body = await res.json();
    expect(body.totals.sent).toBe(5);
    expect(body.counts.on_time).toBe(3);
    expect(body.counts.late).toBe(1);
    expect(body.counts.very_late).toBe(1);
    expect(body.totals.on_time_pct).toBe(60); // 3/5
    expect(body.totals.late_pct).toBe(20);    // 1/5
    expect(body.totals.very_late_pct).toBe(20);
  });

  test('avg drift_ms is mean over non-null payload values', async () => {
    const events = [makeSentEvent(1000), makeSentEvent(2000), makeSentEvent(3000)];
    mockSupa.setResponse('audit_events:select', events);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });

    const res = await call();
    const body = await res.json();
    expect(body.totals.avg_drift_ms).toBe(2000);
  });

  test('daily breakdown groups events by date and sorts desc', async () => {
    const events = [
      makeSentEvent(500, 0),   // today
      makeSentEvent(800, 0),   // today
      makeSentEvent(700, 1),   // yesterday
      makeSentEvent(70_000, 1), // yesterday, late
    ];
    mockSupa.setResponse('audit_events:select', events);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });

    const res = await call();
    const body = await res.json();
    expect(body.daily.length).toBe(2);
    // newest first
    expect(body.daily[0].day > body.daily[1].day).toBe(true);
    // today: 2 sent, 2 on-time
    expect(body.daily[0].sent).toBe(2);
    expect(body.daily[0].on_time).toBe(2);
    // yesterday: 2 sent, 1 on-time, 1 late
    expect(body.daily[1].sent).toBe(2);
    expect(body.daily[1].on_time).toBe(1);
    expect(body.daily[1].late).toBe(1);
  });

  test('since=7d label propagated in response', async () => {
    mockSupa.setResponse('audit_events:select', []);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    const res = await call('7d');
    const body = await res.json();
    expect(body.since).toBe('7d');
  });

  test('since=invalid defaults to 24h', async () => {
    mockSupa.setResponse('audit_events:select', []);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    const res = await call('garbage');
    const body = await res.json();
    expect(body.since).toBe('24h');
  });
});
