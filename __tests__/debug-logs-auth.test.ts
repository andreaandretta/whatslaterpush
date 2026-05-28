/**
 * Auth regression test for DELETE /api/debug-logs after the deprecated
 * hardcoded token was removed (Sprint 4 cluster B, grace period set in
 * commit d36b635).
 *
 * Pre-removal: matched either DEBUG_LOGS_SECRET env var OR the hardcoded
 * `sk_cron_schedwhats_2024_secure` literal, with a WARN log.
 * Post-removal: only DEBUG_LOGS_SECRET env var is accepted.
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
    DEBUG_LOGS_SECRET: 'env-secret-correct',
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function mockRequest(url: string): any {
  return { url } as any;
}

describe('DELETE /api/debug-logs — deprecated token rejected', () => {
  test('old hardcoded token sk_cron_schedwhats_2024_secure returns 401 (was 200+WARN before Sprint 4)', async () => {
    const { DELETE } = await import('../app/api/debug-logs/route');
    const res = await DELETE(
      mockRequest('https://x.test/api/debug-logs?secret=sk_cron_schedwhats_2024_secure')
    );
    expect(res.status).toBe(401);
    // Crucially: no delete was attempted on webhook_logs.
    const deleteCall = mockSupa.calls.find(c => c.table === 'webhook_logs' && c.operation === 'delete');
    expect(deleteCall).toBeUndefined();
  });

  test('correct DEBUG_LOGS_SECRET still succeeds (no regression on the supported path)', async () => {
    const { DELETE } = await import('../app/api/debug-logs/route');
    const res = await DELETE(mockRequest('https://x.test/api/debug-logs?secret=env-secret-correct'));
    expect(res.status).toBe(200);
    expect(mockSupa.calls.find(c => c.table === 'webhook_logs' && c.operation === 'delete')).toBeDefined();
  });
});
