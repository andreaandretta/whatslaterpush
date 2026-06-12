/**
 * POST /api/ops/egress/unquarantine — Fase 0 §6 manual override.
 *
 * Allows Andrea (via Cowork tower) to release an egress from quarantine
 * after buying a new IP / refreshing IP reputation. Gated by OPS_SECRET
 * (the same secret used by the other /api/ops/* endpoints, middleware
 * already exempts /api/ops/* from the sw_session cookie auth).
 */
import { NextRequest } from 'next/server';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('POST /api/ops/egress/unquarantine', () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    process.env.OPS_SECRET = 'secret123';
  });
  afterAll(() => { process.env = origEnv; });

  it('rejects request without OPS_SECRET', async () => {
    const { POST } = await import('../app/api/ops/egress/unquarantine/route');
    const req = new NextRequest('http://localhost/api/ops/egress/unquarantine?id=ipr-fra-01', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects request when id query param missing', async () => {
    const { POST } = await import('../app/api/ops/egress/unquarantine/route');
    const req = new NextRequest('http://localhost/api/ops/egress/unquarantine?secret=secret123', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('accepts request with correct OPS_SECRET and writes egress_unquarantine audit', async () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
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
        })),
        insert: mockInsert,
      })),
    });
    const { POST } = await import('../app/api/ops/egress/unquarantine/route');
    const req = new NextRequest('http://localhost/api/ops/egress/unquarantine?id=ipr-fra-01&secret=secret123', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'egress_unquarantine',
      payload: expect.objectContaining({ egress_id: 'ipr-fra-01' }),
    }));
  });

  it('accepts secret via x-ops-secret header', async () => {
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
        })),
        insert: jest.fn().mockResolvedValue({ error: null }),
      })),
    });
    const { POST } = await import('../app/api/ops/egress/unquarantine/route');
    const req = new NextRequest('http://localhost/api/ops/egress/unquarantine?id=ipr-fra-01', {
      method: 'POST',
      headers: { 'x-ops-secret': 'secret123' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
