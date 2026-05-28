/**
 * Tests for daily report data collection logic.
 */

import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const fetchMock = createFetchMock();

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
    DO_API_TOKEN: 'test-do-token',
    DO_DROPLET_ID: '12345',
    STRIPE_SECRET_KEY: 'sk_test_123',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

import { collectDailyReport, formatWhatsAppReport, pruneOldAuditEvents, AUDIT_RETENTION_DAYS } from '../app/api/cron/daily-report/route';

describe('collectDailyReport', () => {
  test('collects all metrics into a report object', async () => {
    // Mock DO API for both fetchDropletHistory24h and fetchDropletMetrics
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/memory_free', {
      data: { result: [{ values: [['1712200000', '644245094'], ['1712203600', '858993459']] }] }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/memory_available', {
      data: { result: [{ values: [['1712200000', '2147483648'], ['1712203600', '2147483648']] }] }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/cpu', {
      data: { result: [{ metric: { mode: 'idle' }, values: [['1712200000', '75']] }] }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/filesystem_free', {
      data: { result: [{ values: [['1712200000', '17179869184']] }] }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/filesystem_size', {
      data: { result: [{ values: [['1712200000', '26843545600']] }] }
    });

    // Mock Supabase queries
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 47 });
    mockSupa.setResponse('user_instances:select', []);

    // Mock Stripe
    fetchMock.setJsonResponse('/v1/charges', { data: [] });
    fetchMock.setJsonResponse('/v1/subscriptions', { data: [] });

    const report = await collectDailyReport();
    expect(report).toHaveProperty('ram_peak_percent');
    expect(report).toHaveProperty('messages_sent');
    expect(report).toHaveProperty('active_senders');
    expect(report).toHaveProperty('mrr');
    expect(typeof report.ram_peak_percent).toBe('number');
  });
});

describe('formatWhatsAppReport', () => {
  test('formats report as readable WhatsApp message', () => {
    const report = {
      report_date: '2026-04-04',
      ram_peak_percent: 72,
      ram_peak_time: '2026-04-04T12:32:00Z',
      cpu_avg_percent: 23,
      disk_percent: 31,
      messages_sent: 47,
      messages_failed: 2,
      active_senders: 5,
      new_users: 3,
      churned_trials: 1,
      daily_revenue: 14.98,
      mrr: 89.91,
    };
    const text = formatWhatsAppReport(report);
    expect(text).toContain('72%');
    expect(text).toContain('47');
    expect(text).toContain('14.98');
    expect(text).toContain('89.91');
  });
});

describe('pruneOldAuditEvents', () => {
  test('returns the prune count from Supabase and targets created_at < 90d cutoff', async () => {
    mockSupa.setResponse('audit_events:delete', null, null, { count: 47 });
    const pruned = await pruneOldAuditEvents();
    expect(pruned).toBe(47);
    expect(AUDIT_RETENTION_DAYS).toBe(90);

    const delCall = mockSupa.calls.find(c => c.table === 'audit_events' && c.operation === 'delete');
    expect(delCall).toBeDefined();
    const ltCall = delCall!.chain.find(c => c.method === 'lt' && c.args[0] === 'created_at');
    expect(ltCall).toBeDefined();
    const cutoffMs = new Date(ltCall!.args[1] as string).getTime();
    const expectedMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5_000);
  });

  test('returns 0 when nothing matches the cutoff (no rows >90d)', async () => {
    mockSupa.setResponse('audit_events:delete', null, null, { count: 0 });
    const pruned = await pruneOldAuditEvents();
    expect(pruned).toBe(0);
  });
});
