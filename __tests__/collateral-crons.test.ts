/**
 * TDD — Task 56 (#6 heartbeat cron) + Task 57 (sentinella upstream).
 *
 * Lezione hotfix c9fe33a: daily-report e i cleanup sono rimasti rotti per
 * SETTIMANE (401 a ogni run) senza che nessun check li osservasse. Ora ogni
 * cron timbra ops_heartbeat e checkCollateralCrons confronta i timbri con la
 * cadenza attesa. La sentinella upstream è il preavviso del prossimo "muro
 * WhatsApp" (28-29 lug: protocollo cambiato, scoperto solo il 17 ago).
 */
import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
    ADMIN_PHONE: '393000000000',
    ADMIN_EMAIL: 'op@test.it',
    RESEND_API_KEY: 're_test',
    CRON_SECRET: 'cron-secret-test',
  };
  mockSupa.setResponse('user_instances:select', null);
  fetchMock.setHandler('api.resend.com', async () => ({ ok: true, status: 200, json: async () => ({ id: 'em' }), text: async () => '{}' }));
  (global as any).fetch = fetchMock.mockFetch;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

import { checkCollateralCrons } from '../app/lib/monitoring';
import { stampHeartbeat } from '../app/lib/heartbeat';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

describe('Task 56 — checkCollateralCrons', () => {
  test('tutti i battiti freschi → ok', async () => {
    mockSupa.setResponse('ops_heartbeat:select', [
      { name: 'daily-report', ts: hoursAgo(2) },
      { name: 'ops-worker', ts: hoursAgo(3) },
      { name: 'cleanup-media', ts: hoursAgo(24) },
      { name: 'cleanup-webhook-logs', ts: hoursAgo(24) },
    ]);
    const r = await checkCollateralCrons();
    expect(r.status).toBe('ok');
  });

  test('daily-report in ritardo (30h) → warning db-only, col nome del cron', async () => {
    mockSupa.setResponse('ops_heartbeat:select', [{ name: 'daily-report', ts: hoursAgo(30) }]);
    const r = await checkCollateralCrons();
    expect(r.status).toBe('warning');
    expect(r.message).toContain('daily-report');
    expect((r as any).channels).toEqual(['db']);
  });

  test('daily-report fermo da 60h → critical', async () => {
    mockSupa.setResponse('ops_heartbeat:select', [{ name: 'daily-report', ts: hoursAgo(60) }]);
    const r = await checkCollateralCrons();
    expect(r.status).toBe('critical');
    expect(r.message).toContain('fermo');
  });

  test('nessuna riga (deploy fresco) → ok "primo battito" (nota #10)', async () => {
    mockSupa.setResponse('ops_heartbeat:select', []);
    const r = await checkCollateralCrons();
    expect(r.status).toBe('ok');
  });

  test('stampHeartbeat: upsert con onConflict name (idempotente)', async () => {
    await stampHeartbeat('daily-report');
    const up = mockSupa.calls.find(c => c.table === 'ops_heartbeat' && c.operation === 'upsert');
    expect(up).toBeTruthy();
    expect(up!.args[0].name).toBe('daily-report');
    expect(up!.args[1]).toEqual({ onConflict: 'name' });
  });
});

describe('Task 57 — sentinella upstream', () => {
  function ghHandler(tag: string) {
    fetchMock.setHandler('api.github.com', async () => ({
      ok: true, status: 200,
      json: async () => ({ tag_name: tag, name: `Release ${tag}` }),
      text: async () => '{}',
    }));
  }

  function req(secret?: string) {
    const url = 'http://localhost/api/cron/upstream-watch' + (secret ? `?secret=${secret}` : '');
    const r: any = new Request(url);
    r.nextUrl = new URL(url);
    return r;
  }

  test('401 senza secret', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    (global as any).fetch = fetchMock.mockFetch;
    const { GET } = await import('../app/api/cron/upstream-watch/route');
    const res = await GET(req() as any);
    expect(res.status).toBe(401);
  });

  test('prima osservazione → registra la baseline SENZA email', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    ghHandler('v7.0.0-rc15');
    mockSupa.setResponse('audit_events:select', []); // mai vista prima
    (global as any).fetch = fetchMock.mockFetch;
    const { GET } = await import('../app/api/cron/upstream-watch/route');
    const res = await GET(req('cron-secret-test') as any);
    expect(res.status).toBe(200);
    const inserted = mockSupa.calls.filter(c => c.table === 'audit_events' && c.operation === 'insert');
    expect(inserted.length).toBeGreaterThan(0);
    expect(fetchMock.calls.some(c => c.url.includes('api.resend.com'))).toBe(false);
  });

  test('release nuova rispetto alla baseline → email informativa', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    ghHandler('v7.0.0-rc16');
    mockSupa.setResponse('audit_events:select', [{ payload: { repo: 'WhiskeySockets/Baileys', tag: 'v7.0.0-rc15' } }]);
    (global as any).fetch = fetchMock.mockFetch;
    const { GET } = await import('../app/api/cron/upstream-watch/route');
    const res = await GET(req('cron-secret-test') as any);
    expect(res.status).toBe(200);
    const mail = fetchMock.calls.find(c => c.url.includes('api.resend.com'));
    expect(mail).toBeTruthy();
    const body = JSON.parse(mail!.options.body as string);
    expect(body.text).toContain('v7.0.0-rc15 → v7.0.0-rc16');
  });

  test('stessa release già vista → nessun insert, nessuna email', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    ghHandler('v7.0.0-rc15');
    mockSupa.setResponse('audit_events:select', [{ payload: { repo: 'WhiskeySockets/Baileys', tag: 'v7.0.0-rc15' } }]);
    (global as any).fetch = fetchMock.mockFetch;
    const { GET } = await import('../app/api/cron/upstream-watch/route');
    await GET(req('cron-secret-test') as any);
    expect(mockSupa.calls.some(c => c.table === 'audit_events' && c.operation === 'insert')).toBe(false);
    expect(fetchMock.calls.some(c => c.url.includes('api.resend.com'))).toBe(false);
  });
});
