/**
 * Unit + integration tests for the audit_events logger.
 * Mocks Supabase client globally.
 */
import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function lastAuditInsert() {
  const calls = mockSupa.calls.filter(c => c.table === 'audit_events' && c.operation === 'insert');
  return calls[calls.length - 1];
}

describe('hashContactRef', () => {
  test('returns 8-char hex with h: prefix', async () => {
    const { hashContactRef } = await import('../app/lib/audit');
    const out = await hashContactRef('393331234567');
    expect(out).toMatch(/^h:[0-9a-f]{8}$/);
  });

  test('is deterministic for the same input', async () => {
    const { hashContactRef } = await import('../app/lib/audit');
    const a = await hashContactRef('393331234567');
    const b = await hashContactRef('393331234567');
    expect(a).toBe(b);
  });

  test('produces different output for different inputs', async () => {
    const { hashContactRef } = await import('../app/lib/audit');
    const a = await hashContactRef('393331234567');
    const b = await hashContactRef('393401234567');
    expect(a).not.toBe(b);
  });

  test('handles empty input without throwing', async () => {
    const { hashContactRef } = await import('../app/lib/audit');
    expect(await hashContactRef('')).toBe('h:00000000');
  });
});

describe('maskPhoneForLLM', () => {
  test('produces [#hash6…last4] format for normal E.164 input', async () => {
    const { maskPhoneForLLM } = await import('../app/lib/audit');
    const out = maskPhoneForLLM('393331234567');
    expect(out).toMatch(/^\[#[0-9a-f]{6}…4567\]$/);
  });

  test('returns [REDACTED] for empty or sub-4-char input', async () => {
    const { maskPhoneForLLM } = await import('../app/lib/audit');
    expect(maskPhoneForLLM('')).toBe('[REDACTED]');
    expect(maskPhoneForLLM('39')).toBe('[REDACTED]');
    expect(maskPhoneForLLM('123')).toBe('[REDACTED]');
  });

  test('is deterministic for the same input and diverges for different inputs', async () => {
    const { maskPhoneForLLM } = await import('../app/lib/audit');
    const a = maskPhoneForLLM('393331234567');
    const b = maskPhoneForLLM('393331234567');
    const c = maskPhoneForLLM('393401234567');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('clientIpFromHeaders', () => {
  test('parses x-forwarded-for first IP', async () => {
    const { clientIpFromHeaders } = await import('../app/lib/audit');
    const headers = {
      get: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : null),
    };
    expect(clientIpFromHeaders(headers)).toBe('1.2.3.4');
  });

  test('falls back to x-real-ip when no x-forwarded-for', async () => {
    const { clientIpFromHeaders } = await import('../app/lib/audit');
    const headers = {
      get: (n: string) => (n.toLowerCase() === 'x-real-ip' ? '9.9.9.9' : null),
    };
    expect(clientIpFromHeaders(headers)).toBe('9.9.9.9');
  });

  test('returns null when neither header present', async () => {
    const { clientIpFromHeaders } = await import('../app/lib/audit');
    expect(clientIpFromHeaders({ get: () => null })).toBeNull();
  });
});

describe('logAuditEvent (8 event_types — one test each)', () => {
  test('schedule_created', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({
      userPhone: '393331234567',
      eventType: 'schedule_created',
      payload: { message_id: 'm1', has_recurrence: false },
    });
    const call = lastAuditInsert()!;
    expect(call.args[0].event_type).toBe('schedule_created');
    expect(call.args[0].user_phone).toBe('393331234567');
    expect(call.args[0].payload.message_id).toBe('m1');
  });

  test('message_sent with drift_ms', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({
      userPhone: '393331234567',
      eventType: 'message_sent',
      payload: { message_id: 'm1', drift_ms: 1234, batch_size: 5 },
    });
    expect(lastAuditInsert()!.args[0].payload.drift_ms).toBe(1234);
  });

  test('message_failed with error_code + attempt', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({
      userPhone: '393331234567',
      eventType: 'message_failed',
      payload: { message_id: 'm1', error_code: 'HTTP 500', attempt: 3 },
    });
    expect(lastAuditInsert()!.args[0].event_type).toBe('message_failed');
    expect(lastAuditInsert()!.args[0].payload.attempt).toBe(3);
  });

  test('tier_changed', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({
      userPhone: '393331234567',
      eventType: 'tier_changed',
      payload: { from_plan: 'free', to_plan: 'personal' },
    });
    expect(lastAuditInsert()!.args[0].payload.from_plan).toBe('free');
    expect(lastAuditInsert()!.args[0].payload.to_plan).toBe('personal');
  });

  test('webhook_received (no user_phone — system-wide)', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({
      eventType: 'webhook_received',
      payload: { event_type: 'messages.upsert', instance: 'X', signature_valid: true },
    });
    const ins = lastAuditInsert()!.args[0];
    expect(ins.event_type).toBe('webhook_received');
    expect(ins.user_phone).toBeNull();
    expect(ins.payload.signature_valid).toBe(true);
  });

  test('auth_login with user_agent + ip', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({
      userPhone: '393331234567',
      eventType: 'auth_login',
      payload: { user_agent: 'Mozilla/5.0 …' },
      ipAddress: '1.2.3.4',
    });
    expect(lastAuditInsert()!.args[0].ip_address).toBe('1.2.3.4');
    expect(lastAuditInsert()!.args[0].payload.user_agent).toContain('Mozilla');
  });

  test('auth_logout (cookie expired → userPhone null)', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({
      userPhone: null,
      eventType: 'auth_logout',
      ipAddress: '1.2.3.4',
    });
    expect(lastAuditInsert()!.args[0].event_type).toBe('auth_logout');
    expect(lastAuditInsert()!.args[0].user_phone).toBeNull();
  });

  test('payment_event with stripe details', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({
      userPhone: '393331234567',
      eventType: 'payment_event',
      payload: { stripe_event: 'checkout.session.completed', amount: 499, plan: 'personal' },
    });
    expect(lastAuditInsert()!.args[0].payload.stripe_event).toBe('checkout.session.completed');
  });
});

describe('logAuditEvent — failure handling', () => {
  test('does not throw if Supabase insert errors', async () => {
    // Set the mock to surface an error on insert.
    mockSupa.setResponse('audit_events:insert', null, { message: 'simulated' });
    const { logAuditEvent } = await import('../app/lib/audit');
    await expect(
      logAuditEvent({ userPhone: '393331234567', eventType: 'schedule_created' })
    ).resolves.toBeUndefined();
  });

  test('does not throw if Supabase credentials missing', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { logAuditEvent } = await import('../app/lib/audit');
    await expect(
      logAuditEvent({ eventType: 'schedule_created' })
    ).resolves.toBeUndefined();
  });

  test('writes default empty payload when not provided', async () => {
    const { logAuditEvent } = await import('../app/lib/audit');
    await logAuditEvent({ userPhone: '393331234567', eventType: 'auth_logout' });
    const ins = lastAuditInsert()!.args[0];
    expect(ins.payload).toEqual({});
  });
});
