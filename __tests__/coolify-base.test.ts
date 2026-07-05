/**
 * Runbook §8.1 — COOLIFY_API_URL single source of truth, fail-loud.
 *
 * The 6 Coolify consumers (ops-worker + coolify/{containers,redeploy,manage,
 * logs,env}) used to fall back to the hardcoded DigitalOcean IP
 * `http://161.35.212.68:8000`. That droplet was DESTROYED on 2026-07-05 and the
 * IP will be recycled to a third party: a silent fallback would hand the Bearer
 * COOLIFY_API_TOKEN to an unknown host. These tests lock in the new behavior:
 * no env → loud 500 / failed command, NEVER an outbound request.
 */
import { getCoolifyBase, COOLIFY_NOT_CONFIGURED } from '../app/lib/coolify-base';
import { GET as containersGet } from '../app/api/ops/coolify/containers/route';
import { GET as logsGet } from '../app/api/ops/coolify/logs/route';

const SECRET = 'ops-secret-for-coolify-tests';
const ORIGINAL_ENV = process.env;
const realFetch = global.fetch;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    OPS_SECRET: SECRET,
    COOLIFY_API_TOKEN: 'coolify-token-abc',
  };
  delete process.env.COOLIFY_API_URL;
  delete process.env.COOLIFY_EVOLUTION_UUID;
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

function opsReq(path: string): any {
  return {
    url: `https://whatslaterpush.vercel.app${path}${path.includes('?') ? '&' : '?'}secret=${SECRET}`,
    method: 'GET',
    headers: { get: () => null },
  };
}

describe('getCoolifyBase (lib)', () => {
  test('null when COOLIFY_API_URL is missing — NO hardcoded fallback survives', () => {
    expect(getCoolifyBase()).toBeNull();
  });

  test('null when set but empty/whitespace', () => {
    process.env.COOLIFY_API_URL = '   ';
    expect(getCoolifyBase()).toBeNull();
  });

  test('returns the configured URL, trimming trailing slashes', () => {
    process.env.COOLIFY_API_URL = 'http://157.90.251.241:8000///';
    expect(getCoolifyBase()).toBe('http://157.90.251.241:8000');
  });

  test('plain URL passes through untouched', () => {
    process.env.COOLIFY_API_URL = 'https://coolify.example.com';
    expect(getCoolifyBase()).toBe('https://coolify.example.com');
  });
});

describe('/api/ops/coolify/containers — fail-loud guard', () => {
  test('500 + NO outbound request when COOLIFY_API_URL is missing', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const res = await containersGet(opsReq('/api/ops/coolify/containers'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe(COOLIFY_NOT_CONFIGURED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('when configured, requests hit exactly the configured base', async () => {
    process.env.COOLIFY_API_URL = 'http://157.90.251.241:8000';
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    global.fetch = fetchSpy as any;
    const res = await containersGet(opsReq('/api/ops/coolify/containers'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // applications + services + databases
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).toMatch(/^http:\/\/157\.90\.251\.241:8000\/api\/v1\//);
    }
  });
});

describe('/api/ops/coolify/logs — stale DO default uuid removed', () => {
  test('400 when ?uuid= omitted and COOLIFY_EVOLUTION_UUID unset (old hardcoded pkso00o0… default is gone)', async () => {
    process.env.COOLIFY_API_URL = 'http://157.90.251.241:8000';
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const res = await logsGet(opsReq('/api/ops/coolify/logs'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('COOLIFY_EVOLUTION_UUID env fills the default target', async () => {
    process.env.COOLIFY_API_URL = 'http://157.90.251.241:8000';
    process.env.COOLIFY_EVOLUTION_UUID = 'hopixj64uxzzrfkd2xmurnbd';
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ logs: 'container up' }),
    });
    global.fetch = fetchSpy as any;
    const res = await logsGet(opsReq('/api/ops/coolify/logs'));
    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      'http://157.90.251.241:8000/api/v1/services/hopixj64uxzzrfkd2xmurnbd/logs',
    );
  });

  test('500 + NO outbound request when COOLIFY_API_URL is missing', async () => {
    process.env.COOLIFY_EVOLUTION_UUID = 'hopixj64uxzzrfkd2xmurnbd';
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const res = await logsGet(opsReq('/api/ops/coolify/logs'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe(COOLIFY_NOT_CONFIGURED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
