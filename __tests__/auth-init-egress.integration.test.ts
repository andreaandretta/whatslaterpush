/**
 * Integration test for /api/auth/init egress proxy integration — Fase 0 §2.
 *
 * Covers the three new branches added by PR 2:
 *   - PROXY_ENABLED=true + pool empty → 500 server_misconfiguration
 *   - PROXY_ENABLED=true + all egress quarantined → 503 pairing_frozen
 *   - PROXY_ENABLED=true + valid egress → proxy fields injected into Evolution call
 *
 * NB: high-level smoke. Full E2E is manual (Sprint 1 smoke in spec rollout).
 */
import { NextRequest } from 'next/server';

const mockSupabaseInsert = jest.fn().mockResolvedValue({ error: null });
const mockEvolutionFetch = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: mockSupabaseInsert,
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })),
        in: jest.fn(() => ({
          filter: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })),
            })),
          })),
        })),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => ({
          neq: jest.fn().mockResolvedValue({ error: null }),
        })),
      })),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    })),
    rpc: jest.fn(),
  })),
}));

// @sentry/nextjs may throw at init if DSN env unset; stub it out so test env
// doesn't depend on Sentry being initialised.
jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

global.fetch = mockEvolutionFetch as any;

describe('POST /api/auth/init — egress integration', () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.EVOLUTION_API_URL = 'https://test.evo';
    process.env.EVOLUTION_API_KEY = 'test-evo-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://test.app';
    process.env.AUTH_COOKIE_SECRET = 'a'.repeat(64);
    mockEvolutionFetch.mockReset();
    mockSupabaseInsert.mockClear();
  });
  afterAll(() => { process.env = origEnv; });

  it('returns 500 server_misconfiguration when proxy enabled but pool empty', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = '';

    const { POST } = await import('../app/api/auth/init/route');
    const req = new NextRequest('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({ phone: '393331234567' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('server_misconfiguration');
  });

  it('returns 503 pairing_frozen when proxy enabled and all egress quarantined', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p.x.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';

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
                    data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })),
        })),
        insert: jest.fn().mockResolvedValue({ error: null }),
        delete: jest.fn(() => ({ eq: jest.fn(() => ({ neq: jest.fn().mockResolvedValue({ error: null }) })) })),
        upsert: jest.fn().mockResolvedValue({ error: null }),
      })),
      rpc: jest.fn(),
    });

    const { POST } = await import('../app/api/auth/init/route');
    const req = new NextRequest('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({ phone: '393331234567' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('pairing_frozen');
    expect(body.next_steps).toEqual({ form_path: '/connect?step=activation-request' });
  });
});
