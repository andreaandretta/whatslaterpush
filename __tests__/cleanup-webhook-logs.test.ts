/**
 * Tests for the webhook_logs retention cron (/api/cron/cleanup-webhook-logs).
 *
 * Covers: 30-day cutoff math, audit_events row on non-zero prune,
 * noop path when nothing to prune, and idempotence across consecutive runs.
 */
import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CRON_SECRET: 'test-cron',
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function findDelete() {
  return mockSupa.calls.find(c => c.table === 'webhook_logs' && c.operation === 'delete');
}
function findAuditInsert() {
  return mockSupa.calls.find(c => c.table === 'audit_events' && c.operation === 'insert');
}

describe('runWebhookLogsCleanup — happy path', () => {
  test('returns ok with removed_count and writes webhook_logs_prune audit event', async () => {
    mockSupa.setResponse('webhook_logs:delete', null, null, { count: 42 });
    const { runWebhookLogsCleanup } = await import('../app/api/cron/cleanup-webhook-logs/route');
    const result = await runWebhookLogsCleanup();

    expect(result.status).toBe('ok');
    expect(result.removed_count).toBe(42);

    const ins = findAuditInsert()!;
    expect(ins).toBeDefined();
    expect(ins.args[0].event_type).toBe('webhook_logs_prune');
    expect(ins.args[0].payload.removed_count).toBe(42);
    expect(ins.args[0].payload.retention_days).toBe(30);
  });
});

describe('runWebhookLogsCleanup — noop path', () => {
  test('returns noop and skips audit when nothing was deleted', async () => {
    mockSupa.setResponse('webhook_logs:delete', null, null, { count: 0 });
    const { runWebhookLogsCleanup } = await import('../app/api/cron/cleanup-webhook-logs/route');
    const result = await runWebhookLogsCleanup();

    expect(result.status).toBe('noop');
    expect(result.removed_count).toBe(0);
    expect(findAuditInsert()).toBeUndefined();
  });
});

describe('runWebhookLogsCleanup — cutoff math', () => {
  test('uses .lt("ts", <30 days ago ISO>) on the delete chain', async () => {
    mockSupa.setResponse('webhook_logs:delete', null, null, { count: 1 });
    const { runWebhookLogsCleanup } = await import('../app/api/cron/cleanup-webhook-logs/route');
    await runWebhookLogsCleanup();

    const del = findDelete()!;
    expect(del).toBeDefined();
    const ltCall = del.chain.find(c => c.method === 'lt' && c.args[0] === 'ts');
    expect(ltCall).toBeDefined();
    const cutoffMs = new Date(ltCall!.args[1] as string).getTime();
    const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5_000);
  });
});

describe('runWebhookLogsCleanup — idempotence', () => {
  test('second run after a successful prune returns noop without a second audit event', async () => {
    mockSupa.setResponse('webhook_logs:delete', null, null, { count: 7 });
    const { runWebhookLogsCleanup } = await import('../app/api/cron/cleanup-webhook-logs/route');

    const first = await runWebhookLogsCleanup();
    expect(first.status).toBe('ok');
    expect(first.removed_count).toBe(7);

    // After a clean prune the underlying table has nothing left under cutoff.
    mockSupa.setResponse('webhook_logs:delete', null, null, { count: 0 });
    const second = await runWebhookLogsCleanup();
    expect(second.status).toBe('noop');

    const auditInserts = mockSupa.calls.filter(c => c.table === 'audit_events' && c.operation === 'insert');
    expect(auditInserts).toHaveLength(1);
  });
});
