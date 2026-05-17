/**
 * Integration test for GET /api/admin/contacts-stats.
 * Auth: CRON_SECRET via ?secret=… query string OR `Authorization: Bearer`.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';

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
    CRON_SECRET: 'test-cron-secret',
  };
});

afterEach(() => { process.env = ORIGINAL_ENV; });

async function callStats(secret?: string) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { GET } = await import('../app/api/admin/contacts-stats/route');
  const req: any = mockRequest({}, {});
  req.url = secret
    ? `https://whatslaterpush.vercel.app/api/admin/contacts-stats?secret=${secret}`
    : 'https://whatslaterpush.vercel.app/api/admin/contacts-stats';
  return GET(req);
}

describe('GET /api/admin/contacts-stats', () => {
  test('401 without secret', async () => {
    const res = await callStats();
    expect(res.status).toBe(401);
  });

  test('401 with wrong secret', async () => {
    const res = await callStats('wrong');
    expect(res.status).toBe(401);
  });

  test('returns aggregated stats with correct secret', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', [
      { source: 'CONTACTS_SET',          name: 'Mario',  push_name: 'Mario' },
      { source: 'CONTACTS_SET',          name: 'Luca',   push_name: null },
      { source: 'MESSAGING_HISTORY_SET', name: 'Anna',   push_name: 'Anna' },
      { source: 'MESSAGES_UPSERT',       name: null,     push_name: 'Sara' },
      { source: 'MESSAGES_UPSERT',       name: null,     push_name: null },
      { source: 'CONTACTS_UPDATE',       name: 'Paolo',  push_name: 'Paolo' },
    ]);

    const res = await callStats('test-cron-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_in_cache).toBe(6);
    expect(body.total_with_name).toBe(4);
    expect(body.total_with_only_pushname).toBe(1);
    expect(body.anonymous).toBe(1);
    expect(body.source_breakdown).toEqual({
      CONTACTS_SET: 2,
      MESSAGING_HISTORY_SET: 1,
      MESSAGES_UPSERT: 2,
      CONTACTS_UPDATE: 1,
    });
  });
});
