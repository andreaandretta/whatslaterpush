import { shouldSendMessage, rescheduleTomorrow, rescheduleSoon, applyJitter, buildQuotaRequeueUpdate, buildFailureRequeueUpdate, claimSendAttempt, PendingMessage, UserInstance } from '../app/lib/cron-utils';
import { createMockSupabase } from './helpers/mocks';

function makeMessage(overrides: { user_instances?: Partial<UserInstance> | null } & Partial<Omit<PendingMessage, 'user_instances'>> = {}): PendingMessage {
  const defaultInstance: UserInstance = {
    id: 'inst-1',
    phone_number: '393401234567',
    instance_name: 'SchedWhats-test',
    trial_ends_at: null,
    subscription_plan: 'personal',
    connection_status: 'open',
  };
  const { user_instances: instOverrides, ...msgOverrides } = overrides;
  return {
    id: 'msg-1',
    scheduled_at: '2026-03-14T15:00:00.000Z',
    status: 'pending',
    retry_count: 0,
    recipient_number: '393409876543',
    recipient_name: 'Marco',
    parsed_message: 'Ciao Marco!',
    user_instances: instOverrides === null ? null as any : { ...defaultInstance, ...instOverrides },
    ...msgOverrides,
  } as PendingMessage;
}

describe('shouldSendMessage', () => {
  test('returns "send" for active subscription with open connection', () => {
    const msg = makeMessage();
    expect(shouldSendMessage(msg)).toBe('send');
  });

  test('returns "no_instance" when user_instances is null', () => {
    const msg = makeMessage({ user_instances: null as any });
    expect(shouldSendMessage(msg)).toBe('no_instance');
  });

  test('returns "no_instance" when instance_name is empty', () => {
    const msg = makeMessage({ user_instances: { instance_name: '' } });
    expect(shouldSendMessage(msg)).toBe('no_instance');
  });

  test('returns "disconnected" when connection_status is "close"', () => {
    const msg = makeMessage({ user_instances: { connection_status: 'close' } });
    expect(shouldSendMessage(msg)).toBe('disconnected');
  });

  test('returns "disconnected" when connection_status is "unknown"', () => {
    const msg = makeMessage({ user_instances: { connection_status: 'unknown' } });
    expect(shouldSendMessage(msg)).toBe('disconnected');
  });

  test('returns "disconnected" when connection_status is "connecting"', () => {
    const msg = makeMessage({ user_instances: { connection_status: 'connecting' } });
    expect(shouldSendMessage(msg)).toBe('disconnected');
  });

  test('returns "trial_expired" when subscription is trial and trial_ends_at is in the past', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_plan: 'trial',
        trial_ends_at: '2026-01-01T00:00:00.000Z', // past
      },
    });
    expect(shouldSendMessage(msg)).toBe('trial_expired');
  });

  test('returns "trial_expired" when subscription_plan is empty and no trial date', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_plan: '',
        trial_ends_at: null,
      },
    });
    expect(shouldSendMessage(msg)).toBe('trial_expired');
  });

  test('returns "send" when trial is still active (future trial_ends_at)', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_plan: 'trial',
        trial_ends_at: '2099-12-31T23:59:59.000Z', // far future
      },
    });
    expect(shouldSendMessage(msg)).toBe('send');
  });

  // Free is the terminal post-trial tier: its trial_ends_at is ALWAYS in the
  // past (that's how the user became free). It must NEVER be reported as
  // 'trial_expired' — its 3/day allowance is enforced downstream by
  // claim_daily_quota (dailyLimit=3). Before this fix, every Free user's
  // messages returned 'trial_expired' → paused forever (the 3/day branch was
  // dead code). The existing suite only ever exercised 'trial', hiding it.
  test('returns "send" for free plan with expired trial_ends_at (Free 3/day cap gates downstream, NOT trial_expired)', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_plan: 'free',
        trial_ends_at: '2026-01-01T00:00:00.000Z', // past — every free user is post-trial
      },
    });
    expect(shouldSendMessage(msg)).toBe('send');
  });

  test('returns "send" for free plan with null trial_ends_at', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_plan: 'free',
        trial_ends_at: null,
      },
    });
    expect(shouldSendMessage(msg)).toBe('send');
  });

  test('returns "send" for personal subscription regardless of trial_ends_at', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_plan: 'personal',
        trial_ends_at: '2020-01-01T00:00:00.000Z', // past, but plan is personal
      },
    });
    expect(shouldSendMessage(msg)).toBe('send');
  });

  test('checks connection before trial (disconnected takes priority)', () => {
    const msg = makeMessage({
      user_instances: {
        connection_status: 'close',
        subscription_plan: 'trial',
        trial_ends_at: '2020-01-01T00:00:00.000Z',
      },
    });
    // Should return disconnected, not trial_expired
    expect(shouldSendMessage(msg)).toBe('disconnected');
  });
});

// FIX 2: every requeue back to 'pending' MUST clear send_attempted_at, otherwise
// a row that previously reached the send path carries a stale timestamp into its
// next attempt; if that attempt's lambda dies in the pre-fetch window, the
// stale-'processing' recovery (send-messages:156-165) mis-marks it 'sent' without
// actually sending it. These builders centralise that invariant so the route's
// two requeue sites cannot forget it.
describe('buildQuotaRequeueUpdate', () => {
  test('returns status pending and CLEARS send_attempted_at', () => {
    expect(buildQuotaRequeueUpdate()).toEqual({ status: 'pending', send_attempted_at: null });
  });
});

describe('buildFailureRequeueUpdate', () => {
  const NOW = new Date('2026-06-15T18:00:00.000Z').getTime();

  test('retry < 3 → pending, reschedule +N*5min, CLEARS send_attempted_at', () => {
    const u = buildFailureRequeueUpdate({ newRetryCount: 1, errorMessage: 'HTTP 500', originalScheduledAt: '2026-06-15T17:00:00.000Z', now: NOW });
    expect(u.status).toBe('pending');
    expect(u.send_attempted_at).toBeNull();
    expect(u.retry_count).toBe(1);
    expect(u.error_message).toBe('HTTP 500');
    expect(u.scheduled_at).toBe('2026-06-15T18:05:00.000Z'); // now + 1×5min
  });

  test('retry 2 → pending, reschedule +10min, CLEARS send_attempted_at', () => {
    const u = buildFailureRequeueUpdate({ newRetryCount: 2, errorMessage: 'x', originalScheduledAt: '2026-06-15T17:00:00.000Z', now: NOW });
    expect(u.status).toBe('pending');
    expect(u.send_attempted_at).toBeNull();
    expect(u.scheduled_at).toBe('2026-06-15T18:10:00.000Z');
  });

  test('retry >= 3 → terminal failed, keeps original scheduled_at, still CLEARS send_attempted_at', () => {
    const u = buildFailureRequeueUpdate({ newRetryCount: 3, errorMessage: 'final', originalScheduledAt: '2026-06-15T17:00:00.000Z', now: NOW });
    expect(u.status).toBe('failed');
    expect(u.send_attempted_at).toBeNull();
    expect(u.scheduled_at).toBe('2026-06-15T17:00:00.000Z'); // original — no reschedule on terminal
    expect(u.retry_count).toBe(3);
  });
});

describe('rescheduleTomorrow', () => {
  test('adds exactly 1 day to scheduled_at', () => {
    const result = rescheduleTomorrow('2026-03-14T15:00:00.000Z');
    expect(result).toBe('2026-03-15T15:00:00.000Z');
  });

  test('handles month boundary', () => {
    const result = rescheduleTomorrow('2026-03-31T10:00:00.000Z');
    expect(result).toBe('2026-04-01T10:00:00.000Z');
  });

  test('handles year boundary', () => {
    const result = rescheduleTomorrow('2026-12-31T23:59:00.000Z');
    expect(result).toBe('2027-01-01T23:59:00.000Z');
  });

  test('preserves time component', () => {
    const result = rescheduleTomorrow('2026-06-15T08:30:45.123Z');
    expect(result).toBe('2026-06-16T08:30:45.123Z');
  });
});

describe('rescheduleSoon', () => {
  test('adds default 5 minutes when no arg passed', () => {
    const result = rescheduleSoon('2026-06-15T18:00:00.000Z');
    expect(result).toBe('2026-06-15T18:05:00.000Z');
  });

  test('adds custom N minutes (30 — cool-down use case)', () => {
    const result = rescheduleSoon('2026-06-15T18:00:00.000Z', 30);
    expect(result).toBe('2026-06-15T18:30:00.000Z');
  });

  test('crosses hour boundary correctly', () => {
    const result = rescheduleSoon('2026-06-15T17:58:00.000Z', 5);
    expect(result).toBe('2026-06-15T18:03:00.000Z');
  });

  test('crosses day boundary at midnight', () => {
    const result = rescheduleSoon('2026-06-15T23:50:00.000Z', 30);
    expect(result).toBe('2026-06-16T00:20:00.000Z');
  });
});

describe('applyJitter', () => {
  const BASE = '2026-06-15T18:00:00.000Z';
  const BASE_MS = new Date(BASE).getTime();

  test('returns a timestamp >= base (offset is non-negative)', () => {
    for (let i = 0; i < 50; i++) {
      const shifted = new Date(applyJitter(BASE)).getTime();
      expect(shifted).toBeGreaterThanOrEqual(BASE_MS);
    }
  });

  test('default max jitter is 15000ms (15 seconds)', () => {
    for (let i = 0; i < 100; i++) {
      const shifted = new Date(applyJitter(BASE)).getTime();
      expect(shifted - BASE_MS).toBeLessThanOrEqual(15_000);
    }
  });

  test('respects custom maxJitterMs', () => {
    const customMax = 5_000;
    for (let i = 0; i < 100; i++) {
      const shifted = new Date(applyJitter(BASE, customMax)).getTime();
      const offset = shifted - BASE_MS;
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(customMax);
    }
  });

  test('distributes across the window (100 calls produce >=20 unique offsets)', () => {
    // With 15s of jitter at ms precision, 100 random samples should produce
    // far more than 20 distinct values. Catches accidental "always returns 0"
    // bugs and verifies real randomness.
    const offsets = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const shifted = new Date(applyJitter(BASE)).getTime();
      offsets.add(shifted - BASE_MS);
    }
    expect(offsets.size).toBeGreaterThanOrEqual(20);
  });

  test('preserves ISO 8601 format', () => {
    const result = applyJitter(BASE);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('claimSendAttempt — atomic point-of-no-return send gate (anti double-send)', () => {
  test('returns true when the conditional update claims the row (send_attempted_at was null)', async () => {
    const mock = createMockSupabase();
    mock.setResponse('scheduled_messages:update', [{ id: 'm1' }]);
    expect(await claimSendAttempt(mock.client as any, 'm1')).toBe(true);
  });

  test('returns false when the row was already attempted (0 rows) -> caller must skip', async () => {
    const mock = createMockSupabase();
    mock.setResponse('scheduled_messages:update', []);
    expect(await claimSendAttempt(mock.client as any, 'm1')).toBe(false);
  });

  test('returns false on a null/ambiguous result (never assume the claim won)', async () => {
    const mock = createMockSupabase(); // no setResponse -> data is null
    expect(await claimSendAttempt(mock.client as any, 'm1')).toBe(false);
  });

  test('issues the single-winner guard: stamp send_attempted_at WHERE id=msgId AND send_attempted_at IS NULL', async () => {
    const mock = createMockSupabase();
    mock.setResponse('scheduled_messages:update', [{ id: 'm1' }]);
    await claimSendAttempt(mock.client as any, 'm1');

    const call = mock.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'update')!;
    expect(call).toBeDefined();
    // payload stamps the timestamp
    expect(call.args[0]).toHaveProperty('send_attempted_at');
    expect(typeof call.args[0].send_attempted_at).toBe('string');
    // WHERE id = msgId
    const idEq = call.chain.find((c) => c.method === 'eq' && c.args[0] === 'id');
    expect(idEq!.args[1]).toBe('m1');
    // WHERE send_attempted_at IS NULL  — the atomic single-winner guard
    const isNull = call.chain.find((c) => c.method === 'is' && c.args[0] === 'send_attempted_at');
    expect(isNull).toBeDefined();
    expect(isNull!.args[1]).toBeNull();
  });
});
