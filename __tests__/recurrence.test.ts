import { parseRule, isValidRule, nextOccurrence, nextOccurrences, reconcileRecurringChain } from '../app/lib/recurrence';

// FIX 3: the cron's reconciliation sweep is the single place that guarantees a
// recurring chain's next occurrence exists, regardless of how the previous one
// ended (happy-path, stale-recovery, or a lambda death between status='sent' and
// the insert). This pure helper encodes the decision; the unique index makes the
// resulting insert idempotent/race-safe.
describe('reconcileRecurringChain', () => {
  const DAILY = 'FREQ=DAILY';

  test('no insert when the chain still has a live (non-terminal) row', () => {
    expect(reconcileRecurringChain({ hasLiveRow: true, latestStatus: 'sent', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: DAILY }))
      .toEqual({ insert: false });
  });

  test('no insert when the latest row was cancelled (user stopped the chain — do NOT revive)', () => {
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'cancelled', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: DAILY }))
      .toEqual({ insert: false });
  });

  test('no insert when the latest row is non-terminal (defensive)', () => {
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'pending', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: DAILY }))
      .toEqual({ insert: false });
  });

  test('inserts next DAILY occurrence when chain is dead and latest was sent', () => {
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: DAILY }))
      .toEqual({ insert: true, scheduledAt: '2026-06-16T09:00:00.000Z' });
  });

  test('inserts next occurrence when latest was FAILED (failed must not kill the chain)', () => {
    const r = reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'failed', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(r.insert).toBe(true);
  });

  test('no insert when the rule is invalid', () => {
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: 'FREQ=YEARLY' }))
      .toEqual({ insert: false });
  });

  test('next occurrence is deterministic (no jitter), preserving time-of-day', () => {
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-06-15T18:30:45.123Z', rule: DAILY }))
      .toEqual({ insert: true, scheduledAt: '2026-06-16T18:30:45.123Z' });
  });
});

describe('parseRule', () => {
  test('parses FREQ=DAILY', () => {
    expect(parseRule('FREQ=DAILY')).toEqual({ freq: 'DAILY' });
  });

  test('parses FREQ=WEEKLY with single day', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=TU')).toEqual({ freq: 'WEEKLY', byDay: ['TU'] });
  });

  test('parses FREQ=WEEKLY with multiple days and canonicalizes order', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=FR,MO,WE')).toEqual({ freq: 'WEEKLY', byDay: ['MO', 'WE', 'FR'] });
  });

  test('parses FREQ=MONTHLY;BYMONTHDAY=N', () => {
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=15')).toEqual({ freq: 'MONTHLY', byMonthDay: 15 });
  });

  test('is case-insensitive on tokens', () => {
    expect(parseRule('freq=weekly;byday=mo')).toEqual({ freq: 'WEEKLY', byDay: ['MO'] });
  });

  test('rejects empty string', () => {
    expect(parseRule('')).toBeNull();
  });

  test('rejects unknown FREQ', () => {
    expect(parseRule('FREQ=YEARLY')).toBeNull();
  });

  test('rejects FREQ=WEEKLY without BYDAY', () => {
    expect(parseRule('FREQ=WEEKLY')).toBeNull();
  });

  test('rejects FREQ=WEEKLY with bad day code', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=XX')).toBeNull();
  });

  test('rejects FREQ=MONTHLY without BYMONTHDAY', () => {
    expect(parseRule('FREQ=MONTHLY')).toBeNull();
  });

  test('rejects BYMONTHDAY out of range', () => {
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=0')).toBeNull();
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=32')).toBeNull();
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=abc')).toBeNull();
  });

  test('rejects segments without =', () => {
    expect(parseRule('FREQ=DAILY;foo')).toBeNull();
  });
});

describe('isValidRule', () => {
  test('true for valid rules', () => {
    expect(isValidRule('FREQ=DAILY')).toBe(true);
    expect(isValidRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe(true);
    expect(isValidRule('FREQ=MONTHLY;BYMONTHDAY=1')).toBe(true);
  });

  test('false for invalid rules', () => {
    expect(isValidRule('')).toBe(false);
    expect(isValidRule('FREQ=BOGUS')).toBe(false);
    expect(isValidRule('not-a-rule')).toBe(false);
  });
});

describe('nextOccurrence — DAILY', () => {
  test('adds exactly 1 day, preserves time', () => {
    const from = new Date('2026-06-15T18:00:00.000Z'); // Monday
    const next = nextOccurrence('FREQ=DAILY', from)!;
    expect(next.toISOString()).toBe('2026-06-16T18:00:00.000Z');
  });

  test('handles month boundary', () => {
    const from = new Date('2026-06-30T18:00:00.000Z');
    const next = nextOccurrence('FREQ=DAILY', from)!;
    expect(next.toISOString()).toBe('2026-07-01T18:00:00.000Z');
  });
});

describe('nextOccurrence — WEEKLY', () => {
  test('finds next single day (Tuesday after Monday)', () => {
    const from = new Date('2026-06-15T18:00:00.000Z'); // Monday
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=TU', from)!;
    expect(next.toISOString()).toBe('2026-06-16T18:00:00.000Z'); // Tuesday
  });

  test('finds same-day-of-week next week (Monday → Monday)', () => {
    const from = new Date('2026-06-15T18:00:00.000Z'); // Monday
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=MO', from)!;
    expect(next.toISOString()).toBe('2026-06-22T18:00:00.000Z'); // following Monday
  });

  test('picks earliest of multiple days', () => {
    const from = new Date('2026-06-15T18:00:00.000Z'); // Monday
    // BYDAY=MO,WE,FR — from Monday, next earliest is Wednesday
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR', from)!;
    expect(next.toISOString()).toBe('2026-06-17T18:00:00.000Z'); // Wednesday
  });

  test('wraps to next week when only past days in list', () => {
    const from = new Date('2026-06-19T18:00:00.000Z'); // Friday
    // BYDAY=MO,WE — from Friday, next is next Monday (not this week)
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=MO,WE', from)!;
    expect(next.toISOString()).toBe('2026-06-22T18:00:00.000Z'); // Monday
  });
});

describe('nextOccurrence — MONTHLY', () => {
  test('next month same day-of-month', () => {
    const from = new Date('2026-06-15T18:00:00.000Z');
    const next = nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=15', from)!;
    expect(next.toISOString()).toBe('2026-07-15T18:00:00.000Z');
  });

  test('skips months without day N (June has 30 days, BYMONTHDAY=31 lands on July)', () => {
    // May/June/July 2026 are all CEST in Europe/Rome — no DST boundary
    // crossed, so this assertion is timezone-stable.
    const from = new Date('2026-05-31T18:00:00.000Z');
    const next = nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=31', from)!;
    expect(next.toISOString()).toBe('2026-07-31T18:00:00.000Z');
  });

  test('handles BYMONTHDAY=1 correctly', () => {
    const from = new Date('2026-06-15T08:00:00.000Z');
    const next = nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=1', from)!;
    expect(next.toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });

  test('crosses year boundary', () => {
    const from = new Date('2026-12-15T18:00:00.000Z');
    const next = nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=15', from)!;
    expect(next.toISOString()).toBe('2027-01-15T18:00:00.000Z');
  });
});

describe('nextOccurrence — invalid rules', () => {
  test('returns null for invalid rule', () => {
    const from = new Date('2026-06-15T18:00:00.000Z');
    expect(nextOccurrence('not-a-rule', from)).toBeNull();
  });
});

describe('nextOccurrences', () => {
  test('returns N daily occurrences, time-of-day preserved', () => {
    const from = new Date('2026-06-15T18:00:00.000Z');
    const out = nextOccurrences('FREQ=DAILY', from, 3);
    expect(out.map(d => d.toISOString())).toEqual([
      '2026-06-16T18:00:00.000Z',
      '2026-06-17T18:00:00.000Z',
      '2026-06-18T18:00:00.000Z',
    ]);
  });

  test('returns 3 consecutive weekly occurrences (BYDAY=TU from Monday)', () => {
    const from = new Date('2026-06-15T18:00:00.000Z'); // Monday
    const out = nextOccurrences('FREQ=WEEKLY;BYDAY=TU', from, 3);
    expect(out.map(d => d.toISOString())).toEqual([
      '2026-06-16T18:00:00.000Z',
      '2026-06-23T18:00:00.000Z',
      '2026-06-30T18:00:00.000Z',
    ]);
  });

  test('returns 3 monthly occurrences for BYMONTHDAY=15 (summer, no DST crossing)', () => {
    const from = new Date('2026-05-15T18:00:00.000Z');
    const out = nextOccurrences('FREQ=MONTHLY;BYMONTHDAY=15', from, 3);
    expect(out.map(d => d.toISOString())).toEqual([
      '2026-06-15T18:00:00.000Z',
      '2026-07-15T18:00:00.000Z',
      '2026-08-15T18:00:00.000Z',
    ]);
  });

  test('returns empty array when rule is invalid', () => {
    expect(nextOccurrences('INVALID', new Date(), 3)).toEqual([]);
  });
});
