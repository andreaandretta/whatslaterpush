/**
 * Watchdog per-egress tests — Fase 0 §6.
 *
 * Splits checkPairingBlackout into:
 *   (a) per-egress check (proxy mode): quarantines an egress when
 *       started>=5 / completed=0 in last 24h
 *   (b) legacy global check (pre-A1 era): preserved for backwards compat,
 *       auto-disables after PAIRING_PROXY_ENABLED_SINCE + 25h.
 *
 * Adds checkAllEgressDown: critical when 100% of the pool is quarantined.
 */
import { checkPairingBlackout, checkAllEgressDown } from '../app/lib/monitoring';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('checkPairingBlackout per-egress', () => {
  const origEnv = process.env;
  let mockFrom: jest.Mock;
  let mockInsert: jest.Mock;

  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom = jest.fn();
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({ from: mockFrom });
  });
  afterAll(() => { process.env = origEnv; });

  it('quarantines egress with 5+ started and 0 completed in 24h', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    mockFrom.mockImplementation((_table: string) => ({
      select: jest.fn(() => ({
        // checkPairingBlackout window read
        in: jest.fn(() => ({
          gte: jest.fn().mockResolvedValue({
            data: [
              { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
              { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
              { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
              { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
              { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
            ],
            error: null,
          }),
          // isEgressQuarantined chain (called by quarantineEgress idempotency check)
          filter: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => ({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
        })),
      })),
      insert: mockInsert,
    }));

    const result = await checkPairingBlackout();
    expect(result.status).toBe('critical');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'egress_quarantine',
      payload: expect.objectContaining({ egress_id: 'ipr-fra-01' }),
    }));
  });
});

describe('checkAllEgressDown', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  });
  afterAll(() => { process.env = origEnv; });

  it('returns ok when pool empty', async () => {
    delete process.env.PAIRING_EGRESS_POOL;
    const result = await checkAllEgressDown();
    expect(result.status).toBe('ok');
  });

  it('returns critical when all egress in pool are quarantined', async () => {
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
    process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
    process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';

    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          in: jest.fn(() => ({
            filter: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { event_type: 'egress_quarantine', payload: { until: futureIso } },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
        })),
        insert: jest.fn().mockResolvedValue({ error: null }),
      })),
    });

    const result = await checkAllEgressDown();
    expect(result.status).toBe('critical');
  });

  it('returns ok when at least one egress is available', async () => {
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
    process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
    process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';

    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    let callCount = 0;
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          in: jest.fn(() => ({
            filter: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn().mockImplementation(() => {
                    callCount++;
                    // first egress quarantined, second clean
                    return Promise.resolve(callCount === 1
                      ? { data: { event_type: 'egress_quarantine', payload: { until: futureIso } }, error: null }
                      : { data: null, error: null });
                  }),
                })),
              })),
            })),
          })),
        })),
        insert: jest.fn().mockResolvedValue({ error: null }),
      })),
    });

    const result = await checkAllEgressDown();
    expect(result.status).toBe('ok');
  });
});
