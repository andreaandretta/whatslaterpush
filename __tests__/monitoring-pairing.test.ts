/**
 * Unit tests for checkPairingBlackout + shouldAlert escalation pass-through.
 *
 * Scope (TS1, intentionally minimal — see grill-me Q5 decision):
 *  - 5 scenarios for the R3 threshold logic (ok / warning / critical paths)
 *  - 1 error path (Supabase query failure -> critical)
 *  - 2 scenarios for shouldAlert(name, status) escalation (Codex F1c)
 *
 * Emission paths (logAuditEvent in auth/init + webhook) are NOT tested here.
 * Those are 2-line straight-line code with no branching; the threshold logic
 * is where bugs hide.
 */

import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
    ADMIN_PHONE: '393000000000',
    ADMIN_EMAIL: 'test@example.com',
  };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

import { checkPairingBlackout, shouldAlert } from '../app/lib/monitoring';

function rows(started: number, completed: number) {
  const out: Array<{ event_type: string }> = [];
  for (let i = 0; i < started; i++) out.push({ event_type: 'pairing_started' });
  for (let i = 0; i < completed; i++) out.push({ event_type: 'pairing_completed' });
  return out;
}

describe('checkPairingBlackout', () => {
  test('ok: completed >= 1 even with many starts', async () => {
    mockSupa.setResponse('audit_events:select', rows(5, 2));
    const result = await checkPairingBlackout();
    expect(result.name).toBe('pairing_blackout');
    expect(result.status).toBe('ok');
    expect(result.message).toContain('2/5');
  });

  test('ok: zero attempts in the 24h window (quiet night / weekend)', async () => {
    mockSupa.setResponse('audit_events:select', rows(0, 0));
    const result = await checkPairingBlackout();
    expect(result.status).toBe('ok');
    expect(result.message).toContain('Nessun tentativo');
  });

  test('warning: 1-4 starts with zero completions (single confused user)', async () => {
    mockSupa.setResponse('audit_events:select', rows(2, 0));
    const result = await checkPairingBlackout();
    expect(result.status).toBe('warning');
    expect(result.message).toContain('2 tentativi');
  });

  test('warning at the upper boundary (4 starts, 0 completions)', async () => {
    mockSupa.setResponse('audit_events:select', rows(4, 0));
    const result = await checkPairingBlackout();
    expect(result.status).toBe('warning');
  });

  test('critical: >=5 starts with zero completions (the May 2026 IPv6 pattern)', async () => {
    mockSupa.setResponse('audit_events:select', rows(7, 0));
    const result = await checkPairingBlackout();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('7 tentativi');
    expect(result.message).toContain('pairing rotto');
  });

  test('critical on Supabase query error', async () => {
    mockSupa.setResponse('audit_events:select', null, { message: 'connection refused' });
    const result = await checkPairingBlackout();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('Query error');
    expect(result.message).toContain('connection refused');
  });
});

// C1 regression: per-egress branch (PAIRING_PROXY_ENABLED=true). A healthy egress
// must NOT be quarantined when its pairings succeed — which only holds once
// pairing_completed carries egress_id (FIX 6a in the webhook).
describe('checkPairingBlackout — per-egress (C1)', () => {
  function egRows(opts: { started: number; completed: number; startedEgress: string; completedEgress: string | null }) {
    const out: Array<{ event_type: string; payload: any }> = [];
    for (let i = 0; i < opts.started; i++) out.push({ event_type: 'pairing_started', payload: { egress_id: opts.startedEgress } });
    for (let i = 0; i < opts.completed; i++) out.push({ event_type: 'pairing_completed', payload: { egress_id: opts.completedEgress } });
    return out;
  }
  const quarantineInsert = () => mockSupa.calls.find(c =>
    c.table === 'audit_events' && c.operation === 'insert' && c.args[0]?.event_type === 'egress_quarantine');

  test('5 SUCCESSFUL pairings on an egress do NOT quarantine it (the exact C1 scenario)', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    mockSupa.setResponse('audit_events:select', egRows({ started: 5, completed: 5, startedEgress: 'eg-1', completedEgress: 'eg-1' }));
    const result = await checkPairingBlackout();
    expect(quarantineInsert()).toBeUndefined();   // egress NOT quarantined
    expect(result.status).not.toBe('critical');
  });

  test('regression guard: the SAME 5+5 WITHOUT egress_id on completed DOES quarantine (the pre-fix bug)', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    mockSupa.setResponse('audit_events:select', egRows({ started: 5, completed: 5, startedEgress: 'eg-1', completedEgress: null }));
    const result = await checkPairingBlackout();
    const q = quarantineInsert();
    expect(q).toBeDefined();
    expect(q!.args[0].payload.egress_id).toBe('eg-1');
    expect(result.status).toBe('critical');
  });

  test('#3 distributed blackout: 3 starts across 3 egresses (9/0) -> critical via the aggregate backstop', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    const out: Array<{ event_type: string; payload: any }> = [];
    for (const eg of ['eg-1', 'eg-2', 'eg-3']) {
      for (let i = 0; i < 3; i++) out.push({ event_type: 'pairing_started', payload: { egress_id: eg } });
    }
    mockSupa.setResponse('audit_events:select', out);
    const result = await checkPairingBlackout();
    expect(quarantineInsert()).toBeUndefined();    // no single egress reached started>=5
    expect(result.status).toBe('critical');        // aggregate over all rows catches it
    expect(result.message).toContain('9 tentativi');
  });
});

describe('shouldAlert escalation pass-through (Codex F1c)', () => {
  test('warning->critical bypasses 1h dedup window', async () => {
    // Last alert was 5min ago at warning level; a fresh critical must pass.
    mockSupa.setResponse('monitoring_alerts:select', [
      { created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), status: 'warning' },
    ]);
    const result = await shouldAlert('pairing_blackout', 'critical');
    expect(result).toBe(true);
  });

  test('critical->critical stays suppressed by 1h dedup (no spam)', async () => {
    mockSupa.setResponse('monitoring_alerts:select', [
      { created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), status: 'critical' },
    ]);
    const result = await shouldAlert('pairing_blackout', 'critical');
    expect(result).toBe(false);
  });

  test('critical->warning regression stays suppressed (partial recovery, no re-page)', async () => {
    mockSupa.setResponse('monitoring_alerts:select', [
      { created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), status: 'critical' },
    ]);
    const result = await shouldAlert('pairing_blackout', 'warning');
    expect(result).toBe(false);
  });

  test('legacy callers (no status arg) keep old behaviour', async () => {
    mockSupa.setResponse('monitoring_alerts:select', [
      { created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), status: 'critical' },
    ]);
    const result = await shouldAlert('pairing_blackout');
    expect(result).toBe(false);
  });
});
