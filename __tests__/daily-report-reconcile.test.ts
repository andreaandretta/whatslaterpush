/**
 * Il daily-report riallinea connection_status con Evolution PRIMA
 * dell'auto-riparazione webhook: un'istanza rimasta 'close' per un
 * CONNECTION_UPDATE perso ma in realtà aperta deve ricevere anche la config
 * webhook (che filtra connection_status='open').
 */
import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const order: string[] = [];
jest.mock('../app/lib/connection-state', () => ({
  reconcileInstanceStates: jest.fn(async () => { order.push('reconcile'); return { checked: 2, fixed: 1, unknown: 0, skipped: false }; }),
}));
jest.mock('../app/lib/webhook-config', () => ({
  refreshWebhooksForOpenInstances: jest.fn(async () => { order.push('webhooks'); return { ok: 1, failed: 0, skipped: false }; }),
}));
jest.mock('../app/lib/droplet', () => ({
  fetchDropletMetrics: jest.fn(async () => null),
  fetchDropletHistory24h: jest.fn(async () => []),
}));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  order.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    CRON_SECRET: 's',
    ADMIN_PHONE: '390000000000',
  };
  delete process.env.STRIPE_SECRET_KEY;
  (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }));
});
afterAll(() => { process.env = ORIGINAL_ENV; });

import { GET } from '../app/api/cron/daily-report/route';

test('riconcilia lo stato delle istanze e poi ripara i webhook', async () => {
  const req: any = { url: 'https://x/api/cron/daily-report?secret=s', headers: { get: () => null } };
  const res = await GET(req);
  const body = await res.json();
  expect(order).toEqual(['reconcile', 'webhooks']);
  expect(body.connection_reconciled).toEqual({ checked: 2, fixed: 1, unknown: 0, skipped: false });
});
