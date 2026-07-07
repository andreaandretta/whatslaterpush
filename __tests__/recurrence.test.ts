import { parseRule, isValidRule, nextOccurrence, nextOccurrences, reconcileRecurringChain, nextRomeMidnight } from '../app/lib/recurrence';

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

  // Healthy chains anchor `nowMs` just after the latest send: the next
  // occurrence is in the future, so the fast-forward clamp is a no-op and the
  // pre-clamp expectations hold unchanged.
  test('inserts next DAILY occurrence when chain is dead and latest was sent', () => {
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: DAILY }, Date.parse('2026-06-15T10:00:00.000Z')))
      .toEqual({ insert: true, scheduledAt: '2026-06-16T09:00:00.000Z' });
  });

  test('inserts next occurrence when latest was FAILED (failed must not kill the chain)', () => {
    const r = reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'failed', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: 'FREQ=WEEKLY;BYDAY=MO' }, Date.parse('2026-06-15T10:00:00.000Z'));
    expect(r.insert).toBe(true);
  });

  test('no insert when the rule is invalid', () => {
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: 'FREQ=YEARLY' }))
      .toEqual({ insert: false });
  });

  test('next occurrence is deterministic (no jitter), preserving time-of-day', () => {
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-06-15T18:30:45.123Z', rule: DAILY }, Date.parse('2026-06-15T19:00:00.000Z')))
      .toEqual({ insert: true, scheduledAt: '2026-06-16T18:30:45.123Z' });
  });

  // Fast-forward clamp (runbook §2, reactivation prerequisite): a chain that
  // stalled for weeks (quota starvation, long disconnect, post-beta backlog)
  // must SKIP its missed occurrences, not deliver them late — recreating a
  // weeks-old "next" makes it instantly due, so the chain would "catch up" by
  // firing stale reminders back-to-back and burning the daily quota.
  test('stalled DAILY chain: missed occurrences are skipped, next is strictly in the future', () => {
    const now = Date.parse('2026-07-07T10:00:00.000Z');
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-06-15T09:00:00.000Z', rule: DAILY }, now))
      .toEqual({ insert: true, scheduledAt: '2026-07-08T09:00:00.000Z' });
  });

  test('stalled WEEKLY chain: lands on the next future target weekday, not a past one', () => {
    // Mondays 09:00 CEST (07:00Z); latest sent Mon 2026-06-01, now Tue Jul 7:
    // Mon Jul 6 is already past → next is Mon Jul 13.
    const now = Date.parse('2026-07-07T10:00:00.000Z');
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-06-01T07:00:00.000Z', rule: 'FREQ=WEEKLY;BYDAY=MO' }, now))
      .toEqual({ insert: true, scheduledAt: '2026-07-13T07:00:00.000Z' });
  });

  test('occurrence exactly at now is NOT used (strictly-future contract)', () => {
    const now = Date.parse('2026-07-07T09:00:00.000Z');
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2026-07-06T09:00:00.000Z', rule: DAILY }, now))
      .toEqual({ insert: true, scheduledAt: '2026-07-08T09:00:00.000Z' });
  });

  test('chain dead for years: fast-forward cap trips -> drop instead of spinning', () => {
    const now = Date.parse('2026-07-07T10:00:00.000Z');
    expect(reconcileRecurringChain({ hasLiveRow: false, latestStatus: 'sent', latestScheduledAt: '2024-01-01T09:00:00.000Z', rule: DAILY }, now))
      .toEqual({ insert: false });
  });
});

describe('nextRomeMidnight', () => {
  // The instant the daily quota resets: reset_daily_counters and
  // claim_daily_quota are keyed to the Europe/Rome calendar date.
  test('CEST (summer, UTC+2)', () => {
    expect(nextRomeMidnight(new Date('2026-07-07T10:00:00.000Z')).toISOString()).toBe('2026-07-07T22:00:00.000Z');
  });

  test('CET (winter, UTC+1)', () => {
    expect(nextRomeMidnight(new Date('2026-01-15T10:00:00.000Z')).toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });

  test('after Rome midnight but before UTC midnight -> the NEXT Rome midnight, not today\'s', () => {
    // 22:30Z on Jul 7 is already Jul 8, 00:30 in Rome.
    expect(nextRomeMidnight(new Date('2026-07-07T22:30:00.000Z')).toISOString()).toBe('2026-07-08T22:00:00.000Z');
  });

  test('DST fall-back eve (2026-10-25 transition): midnight is still CEST', () => {
    expect(nextRomeMidnight(new Date('2026-10-24T12:00:00.000Z')).toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  test('DST spring-forward eve (2026-03-29 transition): midnight is still CET', () => {
    expect(nextRomeMidnight(new Date('2026-03-28T12:00:00.000Z')).toISOString()).toBe('2026-03-28T23:00:00.000Z');
  });

  test('month rollover (Jul 31 -> Aug 1)', () => {
    expect(nextRomeMidnight(new Date('2026-07-31T10:00:00.000Z')).toISOString()).toBe('2026-07-31T22:00:00.000Z');
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

// H7: Italy DST ends Sun 2026-10-25 (CEST->CET) and starts Sun 2026-03-29
// (CET->CEST). A reminder must keep its Europe/Rome wall-clock across both.
describe('nextOccurrence — DST (Europe/Rome) preserves wall-clock', () => {
  test('DAILY across the autumn fall-back keeps 09:00 Rome (CEST 07:00Z -> CET 08:00Z)', () => {
    const from = new Date('2026-10-24T07:00:00.000Z'); // 09:00 CEST
    const next = nextOccurrence('FREQ=DAILY', from)!;
    // 09:00 on Oct 25 is CET (UTC+1) -> 08:00Z. (Old UTC-math gave 07:00Z = 08:00 Rome.)
    expect(next.toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  test('DAILY across the spring forward keeps 09:00 Rome (CET 08:00Z -> CEST 07:00Z)', () => {
    const from = new Date('2026-03-28T08:00:00.000Z'); // 09:00 CET
    const next = nextOccurrence('FREQ=DAILY', from)!;
    // 09:00 on Mar 29 is CEST (UTC+2) -> 07:00Z. (Old UTC-math gave 08:00Z = 10:00 Rome.)
    expect(next.toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });

  test('WEEKLY across the fall-back keeps the wall-clock (Sunday CEST -> next Sunday CET)', () => {
    const from = new Date('2026-10-18T07:00:00.000Z'); // Sun 09:00 CEST
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=SU', from)!;
    expect(next.toISOString()).toBe('2026-10-25T08:00:00.000Z'); // Sun 09:00 CET
  });

  test('MONTHLY across the fall-back keeps the wall-clock', () => {
    const from = new Date('2026-09-25T07:00:00.000Z'); // 09:00 CEST
    const next = nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=25', from)!;
    expect(next.toISOString()).toBe('2026-10-25T08:00:00.000Z'); // 09:00 CET
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
