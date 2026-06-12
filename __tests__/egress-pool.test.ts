import {
  loadEgressFromEnv,
  isEgressQuarantined,
  quarantineEgress,
  getEgressForPairing,
  MisconfigError,
  FrozenError,
} from '../app/lib/egress-pool';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('loadEgressFromEnv', () => {
  const origEnv = process.env;
  beforeEach(() => { process.env = { ...origEnv }; });
  afterAll(() => { process.env = origEnv; });

  it('returns empty array when PAIRING_EGRESS_POOL unset', () => {
    delete process.env.PAIRING_EGRESS_POOL;
    expect(loadEgressFromEnv()).toEqual([]);
  });

  it('returns empty array when PAIRING_EGRESS_POOL is empty string', () => {
    process.env.PAIRING_EGRESS_POOL = '';
    expect(loadEgressFromEnv()).toEqual([]);
  });

  it('parses single egress with all fields', () => {
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'proxy.iproyal.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '12321';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PROTOCOL = 'http';
    process.env.PAIRING_EGRESS_IPR_FRA_01_USERNAME = 'u';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PASSWORD = 'p';
    process.env.PAIRING_EGRESS_IPR_FRA_01_LABEL = 'IPRoyal FRA';
    const pool = loadEgressFromEnv();
    expect(pool).toHaveLength(1);
    expect(pool[0]).toEqual({
      id: 'ipr-fra-01',
      host: 'proxy.iproyal.com',
      port: 12321,
      protocol: 'http',
      username: 'u',
      password: 'p',
      label: 'IPRoyal FRA',
    });
  });

  it('parses multiple egress in pool order', () => {
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.example.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
    process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.example.com';
    process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';
    const pool = loadEgressFromEnv();
    expect(pool.map(e => e.id)).toEqual(['ipr-fra-01', 'web-mil-01']);
  });

  it('skips egress missing host', () => {
    process.env.PAIRING_EGRESS_POOL = 'broken-01';
    process.env.PAIRING_EGRESS_BROKEN_01_PORT = '8080';
    expect(loadEgressFromEnv()).toEqual([]);
  });

  it('skips egress with invalid port', () => {
    process.env.PAIRING_EGRESS_POOL = 'broken-02';
    process.env.PAIRING_EGRESS_BROKEN_02_HOST = 'x.com';
    process.env.PAIRING_EGRESS_BROKEN_02_PORT = 'not-a-number';
    expect(loadEgressFromEnv()).toEqual([]);
  });

  it('skips egress with invalid protocol', () => {
    process.env.PAIRING_EGRESS_POOL = 'broken-03';
    process.env.PAIRING_EGRESS_BROKEN_03_HOST = 'x.com';
    process.env.PAIRING_EGRESS_BROKEN_03_PORT = '80';
    process.env.PAIRING_EGRESS_BROKEN_03_PROTOCOL = 'ftp';
    expect(loadEgressFromEnv()).toEqual([]);
  });

  it('defaults protocol to http when unspecified', () => {
    process.env.PAIRING_EGRESS_POOL = 'min-01';
    process.env.PAIRING_EGRESS_MIN_01_HOST = 'x.com';
    process.env.PAIRING_EGRESS_MIN_01_PORT = '80';
    const pool = loadEgressFromEnv();
    expect(pool[0].protocol).toBe('http');
  });
});

// Helper: build the chained query mock returned by supabase.from('audit_events').select(...)
// The egress quarantine read pipeline is:
//   from('audit_events').select(...).in(...).filter(...).order(...).limit(...).maybeSingle()
function chainedSelect(maybeSingleResult: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      in: () => ({
        filter: () => ({
          order: () => ({
            limit: () => ({ maybeSingle: () => Promise.resolve(maybeSingleResult) }),
          }),
        }),
      }),
    }),
  };
}

describe('isEgressQuarantined', () => {
  let mockFrom: jest.Mock;

  beforeEach(() => {
    mockFrom = jest.fn();
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({ from: mockFrom });
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('returns false when no audit event found', async () => {
    mockFrom.mockReturnValue(chainedSelect({ data: null, error: null }) as any);
    const result = await isEgressQuarantined('ipr-fra-01');
    expect(result).toBe(false);
  });

  it('returns true when latest event is quarantine and until > now', async () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    mockFrom.mockReturnValue(chainedSelect({
      data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } },
      error: null,
    }) as any);
    const result = await isEgressQuarantined('ipr-fra-01');
    expect(result).toBe(true);
  });

  it('returns false when latest event is unquarantine', async () => {
    mockFrom.mockReturnValue(chainedSelect({
      data: { event_type: 'egress_unquarantine', payload: { egress_id: 'ipr-fra-01' } },
      error: null,
    }) as any);
    const result = await isEgressQuarantined('ipr-fra-01');
    expect(result).toBe(false);
  });

  it('returns false when quarantine TTL has expired', async () => {
    const pastIso = new Date(Date.now() - 1000).toISOString();
    mockFrom.mockReturnValue(chainedSelect({
      data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: pastIso } },
      error: null,
    }) as any);
    const result = await isEgressQuarantined('ipr-fra-01');
    expect(result).toBe(false);
  });
});

describe('quarantineEgress idempotency', () => {
  let mockFrom: jest.Mock;
  let insertSpy: jest.Mock;

  beforeEach(() => {
    mockFrom = jest.fn();
    insertSpy = jest.fn().mockResolvedValue({ error: null });
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({ from: mockFrom });
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('skips insert when egress is already quarantined', async () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    mockFrom.mockReturnValue({
      ...chainedSelect({
        data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } },
        error: null,
      }),
      insert: insertSpy,
    } as any);
    await quarantineEgress('ipr-fra-01', 'test-reason');
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('inserts when egress is not currently quarantined', async () => {
    mockFrom.mockReturnValue({
      ...chainedSelect({ data: null, error: null }),
      insert: insertSpy,
    } as any);
    await quarantineEgress('ipr-fra-01', 'blackout_24h', 24);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'egress_quarantine',
      payload: expect.objectContaining({
        egress_id: 'ipr-fra-01',
        reason: 'blackout_24h',
      }),
    }));
  });
});

describe('getEgressForPairing', () => {
  const origEnv = process.env;
  let mockFrom: jest.Mock;

  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockFrom = jest.fn();
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({ from: mockFrom });
  });
  afterAll(() => { process.env = origEnv; });

  it('returns null when PAIRING_PROXY_ENABLED=false', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'false';
    const result = await getEgressForPairing();
    expect(result).toBeNull();
  });

  it('returns null when PAIRING_PROXY_ENABLED is unset', async () => {
    delete process.env.PAIRING_PROXY_ENABLED;
    const result = await getEgressForPairing();
    expect(result).toBeNull();
  });

  it('throws MisconfigError when enabled but pool empty', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = '';
    await expect(getEgressForPairing()).rejects.toThrow(MisconfigError);
  });

  it('throws MisconfigError when enabled but all entries malformed', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = 'broken-01';
    // HOST + PORT unset → loadEgressFromEnv returns []
    await expect(getEgressForPairing()).rejects.toThrow(MisconfigError);
  });

  it('returns first egress when none quarantined', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
    process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
    process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';
    mockFrom.mockReturnValue(chainedSelect({ data: null, error: null }) as any);
    const result = await getEgressForPairing();
    expect(result?.id).toBe('ipr-fra-01');
  });

  it('returns second egress when first is quarantined', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
    process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
    process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';

    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    let callCount = 0;
    mockFrom.mockImplementation(() => ({
      select: () => ({
        in: () => ({
          filter: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => {
                  callCount++;
                  if (callCount === 1) {
                    return Promise.resolve({
                      data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } },
                      error: null,
                    });
                  }
                  return Promise.resolve({ data: null, error: null });
                },
              }),
            }),
          }),
        }),
      }),
    }) as any);
    const result = await getEgressForPairing();
    expect(result?.id).toBe('web-mil-01');
  });

  it('throws FrozenError when all egress quarantined', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
    process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
    process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    // Both egress isEgressQuarantined() return true
    mockFrom.mockImplementation(() => ({
      select: () => ({
        in: () => ({
          filter: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { event_type: 'egress_quarantine', payload: { until: futureIso } },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }) as any);
    await expect(getEgressForPairing()).rejects.toThrow(FrozenError);
  });
});
