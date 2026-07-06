/**
 * Runbook §8.2 — push host-metrics (RAM/disk del server Hetzner).
 *
 * Dopo il decommission DigitalOcean (2026-07-05) l'API DO è morta e l'API
 * Hetzner non espone la memoria: il server POSTa le proprie metriche a
 * /api/ops/host-metrics (cron 60s) e fetchDropletMetrics le legge dalla
 * tabella host_metrics quando HOST_METRICS_SOURCE=push. Questi test coprono:
 * receiver (auth/validazione/insert), lettore push (fresh/stale/vuoto,
 * e nessun accesso Supabase fuori da push mode), gate del watchdog.
 */
import { NextRequest } from 'next/server';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const SECRET = 'ops-secret-host-metrics';
const origEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env = { ...origEnv };
  process.env.OPS_SECRET = SECRET;
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  delete process.env.DO_API_TOKEN;
  delete process.env.DO_DROPLET_ID;
  delete process.env.HOST_METRICS_SOURCE;
});
afterAll(() => {
  process.env = origEnv;
});

function postReq(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://localhost/api/ops/host-metrics', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { authorization: `Bearer ${SECRET}` } : {}),
    },
  });
}

function mockWriterSupabase() {
  const insert = jest.fn().mockResolvedValue({ error: null });
  const lt = jest.fn().mockResolvedValue({ error: null });
  const del = jest.fn(() => ({ lt }));
  const from = jest.fn(() => ({ insert, delete: del }));
  const { createClient } = require('@supabase/supabase-js');
  (createClient as jest.Mock).mockReturnValue({ from });
  return { insert, from, lt };
}

describe('POST /api/ops/host-metrics (receiver)', () => {
  test('401 senza OPS_SECRET', async () => {
    const { POST } = await import('../app/api/ops/host-metrics/route');
    const res = await POST(postReq({ ram_percent: 50 }, false));
    expect(res.status).toBe(401);
  });

  test('400 senza ram_percent valido', async () => {
    mockWriterSupabase();
    const { POST } = await import('../app/api/ops/host-metrics/route');
    expect((await POST(postReq({}))).status).toBe(400);
    expect((await POST(postReq({ ram_percent: 'x' }))).status).toBe(400);
    expect((await POST(postReq({ ram_percent: 250 }))).status).toBe(400);
  });

  test('200: inserisce la riga normalizzata e prune best-effort', async () => {
    const { insert, from } = mockWriterSupabase();
    const { POST } = await import('../app/api/ops/host-metrics/route');
    const res = await POST(
      postReq({ host: 'hetzner-cx23', ram_percent: 43.4, disk_percent: 61, load1: 0.42, uptime_seconds: 12345.9 }),
    );
    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith('host_metrics');
    expect(insert).toHaveBeenCalledWith({
      host: 'hetzner-cx23',
      ram_percent: 43,
      cpu_percent: null,
      disk_percent: 61,
      load1: 0.42,
      uptime_seconds: 12345,
    });
  });

  test('500 quando l\'insert fallisce', async () => {
    const { insert } = mockWriterSupabase();
    insert.mockResolvedValue({ error: { message: 'boom' } });
    const { POST } = await import('../app/api/ops/host-metrics/route');
    const res = await POST(postReq({ ram_percent: 50 }));
    expect(res.status).toBe(500);
  });
});

function mockReaderSupabase(latestRow: any, historyRows: any[] = []) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: latestRow, error: null });
  const metricsChain = { maybeSingle };
  const from = jest.fn(() => ({
    select: jest.fn((cols: string) => {
      if (String(cols).includes('cpu_percent')) {
        // fetchPushedMetrics: .order().limit(1).maybeSingle()
        return { order: jest.fn(() => ({ limit: jest.fn(() => metricsChain) })) };
      }
      // fetchPushedHistory24h: .gte().order().limit(2000) awaited
      return {
        gte: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue({ data: historyRows, error: null }),
          })),
        })),
      };
    }),
  }));
  const { createClient } = require('@supabase/supabase-js');
  (createClient as jest.Mock).mockReturnValue({ from });
  return { from };
}

describe('fetchDropletMetrics in push mode (lettore)', () => {
  test('riga fresca → metriche', async () => {
    process.env.HOST_METRICS_SOURCE = 'push';
    mockReaderSupabase({
      ram_percent: 58,
      cpu_percent: null,
      disk_percent: 40,
      uptime_seconds: 1000,
      created_at: new Date().toISOString(),
    });
    const { fetchDropletMetrics } = await import('../app/lib/droplet');
    expect(await fetchDropletMetrics()).toEqual({
      ram_percent: 58,
      cpu_percent: 0,
      disk_percent: 40,
      uptime_seconds: 1000,
    });
  });

  test('riga stantia (>5 min) → null (fail-loud, mai dati vecchi come buoni)', async () => {
    process.env.HOST_METRICS_SOURCE = 'push';
    mockReaderSupabase({
      ram_percent: 58,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const { fetchDropletMetrics } = await import('../app/lib/droplet');
    expect(await fetchDropletMetrics()).toBeNull();
  });

  test('nessuna riga → null', async () => {
    process.env.HOST_METRICS_SOURCE = 'push';
    mockReaderSupabase(null);
    const { fetchDropletMetrics } = await import('../app/lib/droplet');
    expect(await fetchDropletMetrics()).toBeNull();
  });

  test('storico 24h in push mode legge host_metrics', async () => {
    process.env.HOST_METRICS_SOURCE = 'push';
    const t = new Date().toISOString();
    mockReaderSupabase(null, [{ ram_percent: 61, created_at: t }]);
    const { fetchDropletHistory24h } = await import('../app/lib/droplet');
    expect(await fetchDropletHistory24h()).toEqual([{ time: t, percent: 61 }]);
  });

  test('fuori da push mode senza DO_* → null e ZERO accessi Supabase', async () => {
    const { createClient } = require('@supabase/supabase-js');
    const { fetchDropletMetrics } = await import('../app/lib/droplet');
    expect(await fetchDropletMetrics()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('checkDropletRam gate (watchdog)', () => {
  test('non configurato (no push, no DO_*) → ok informativo', async () => {
    jest.doMock('../app/lib/droplet', () => ({ fetchDropletMetrics: jest.fn() }));
    const { checkDropletRam } = await import('../app/lib/monitoring');
    const r = await checkDropletRam();
    expect(r.status).toBe('ok');
    expect(r.message).toContain('non configurato');
  });

  test('push mode + feed assente/stantio → warning azionabile', async () => {
    process.env.HOST_METRICS_SOURCE = 'push';
    jest.doMock('../app/lib/droplet', () => ({
      fetchDropletMetrics: jest.fn().mockResolvedValue(null),
    }));
    const { checkDropletRam } = await import('../app/lib/monitoring');
    const r = await checkDropletRam();
    expect(r.status).toBe('warning');
    expect(r.message).toContain('cron push');
  });

  test('push mode + RAM 85 → critical (soglie invariate)', async () => {
    process.env.HOST_METRICS_SOURCE = 'push';
    jest.doMock('../app/lib/droplet', () => ({
      fetchDropletMetrics: jest.fn().mockResolvedValue({
        ram_percent: 85, cpu_percent: 0, disk_percent: 0, uptime_seconds: 0,
      }),
    }));
    const { checkDropletRam } = await import('../app/lib/monitoring');
    const r = await checkDropletRam();
    expect(r.status).toBe('critical');
  });
});
