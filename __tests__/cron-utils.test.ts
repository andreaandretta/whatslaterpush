import { shouldSendMessage, rescheduleTomorrow, PendingMessage, UserInstance } from '../app/lib/cron-utils';

function makeMessage(overrides: { user_instances?: Partial<UserInstance> | null } & Partial<Omit<PendingMessage, 'user_instances'>> = {}): PendingMessage {
  const defaultInstance: UserInstance = {
    id: 'inst-1',
    phone_number: '393401234567',
    instance_name: 'SchedWhats-test',
    trial_ends_at: null,
    subscription_status: 'active',
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
        subscription_status: 'trial',
        trial_ends_at: '2026-01-01T00:00:00.000Z', // past
      },
    });
    expect(shouldSendMessage(msg)).toBe('trial_expired');
  });

  test('returns "trial_expired" when subscription_status is empty and no trial date', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_status: '',
        trial_ends_at: null,
      },
    });
    expect(shouldSendMessage(msg)).toBe('trial_expired');
  });

  test('returns "send" when trial is still active (future trial_ends_at)', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_status: 'trial',
        trial_ends_at: '2099-12-31T23:59:59.000Z', // far future
      },
    });
    expect(shouldSendMessage(msg)).toBe('send');
  });

  test('returns "send" for active subscription regardless of trial_ends_at', () => {
    const msg = makeMessage({
      user_instances: {
        subscription_status: 'active',
        trial_ends_at: '2020-01-01T00:00:00.000Z', // past, but status is active
      },
    });
    expect(shouldSendMessage(msg)).toBe('send');
  });

  test('checks connection before trial (disconnected takes priority)', () => {
    const msg = makeMessage({
      user_instances: {
        connection_status: 'close',
        subscription_status: 'trial',
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
