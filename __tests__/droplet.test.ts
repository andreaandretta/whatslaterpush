/**
 * Tests for app/lib/droplet.ts
 * Mocks fetch to test DO API client.
 */

import { createFetchMock } from './helpers/mocks';

const fetchMock = createFetchMock();

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    DO_API_TOKEN: 'test-do-token',
    DO_DROPLET_ID: '12345',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

import { fetchDropletMetrics } from '../app/lib/droplet';

describe('fetchDropletMetrics', () => {
  test('returns ram/cpu/disk percentages from DO API', async () => {
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/memory_free', {
      data: {
        result: [{ values: [['1712200000', '858993459']] }]
      }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/memory_available', {
      data: {
        result: [{ values: [['1712200000', '2147483648']] }]
      }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/cpu', {
      data: {
        result: [
          { metric: { mode: 'idle' }, values: [['1712200000', '82']] },
          { metric: { mode: 'user' }, values: [['1712200000', '12']] },
          { metric: { mode: 'system' }, values: [['1712200000', '6']] },
        ]
      }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/filesystem_free', {
      data: {
        result: [{ values: [['1712200000', '17179869184']] }]
      }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/filesystem_size', {
      data: {
        result: [{ values: [['1712200000', '26843545600']] }]
      }
    });

    const result = await fetchDropletMetrics();
    expect(result.ram_percent).toBeGreaterThanOrEqual(0);
    expect(result.ram_percent).toBeLessThanOrEqual(100);
    expect(result.cpu_percent).toBeGreaterThanOrEqual(0);
    expect(result.disk_percent).toBeGreaterThanOrEqual(0);
    expect(typeof result.uptime_seconds).toBe('number');
  });

  test('returns null when DO_API_TOKEN is missing', async () => {
    delete process.env.DO_API_TOKEN;
    const result = await fetchDropletMetrics();
    expect(result).toBeNull();
  });

  test('returns null when DO API returns error', async () => {
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/memory_free', { error: 'unauthorized' }, 401);
    const result = await fetchDropletMetrics();
    expect(result).toBeNull();
  });
});

describe('fetchDropletHistory24h', () => {
  test('returns hourly RAM data points', async () => {
    const values = Array.from({ length: 24 }, (_, i) => [
      String(1712200000 + i * 3600),
      String(858993459 + i * 10000000),
    ]);
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/memory_free', {
      data: { result: [{ values }] }
    });
    fetchMock.setJsonResponse('/v2/monitoring/metrics/droplet/memory_available', {
      data: { result: [{ values: values.map(v => [v[0], '2147483648']) }] }
    });

    const { fetchDropletHistory24h } = require('../app/lib/droplet');
    const result = await fetchDropletHistory24h();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('time');
    expect(result[0]).toHaveProperty('percent');
  });
});
