import { shouldSendMessage, rescheduleTomorrow, rescheduleSoon, applyJitter, PendingMessage, UserInstance } from '../app/lib/cron-utils';

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
