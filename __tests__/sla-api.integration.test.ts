/**
 * Integration tests for GET /api/admin/sla.
 * Mocks Supabase with synthetic audit_events + scheduled_messages results.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
const SECRET = 'sla-cron-secret';

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    CRON_SECRET: SECRET,
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function call(qs: string = `secret=${SECRET}`) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { GET } = await import('../app/api/admin/sla/route');
  const req: any = mockRequest({});
  req.url = `https://whatslaterpush.vercel.app/api/admin/sla?${qs}`;
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
  test('401 without secret', async () => {
    const res = await call('');
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
    const res = await call(`secret=${SECRET}&since=7d`);
    const body = await res.json();
    expect(body.since).toBe('7d');
  });

  test('since=invalid defaults to 24h', async () => {
    mockSupa.setResponse('audit_events:select', []);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    const res = await call(`secret=${SECRET}&since=garbage`);
    const body = await res.json();
    expect(body.since).toBe('24h');
  });
});
