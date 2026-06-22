/**
 * Tests for the rate limiter (app/lib/rate-limit.ts).
 *
 * H11 — two distinct failure modes around the Business tier:
 *  (1) SPAM_THRESHOLD must sit ABOVE the highest tier cap (Business = 50/day), so a
 *      customer who fully uses their plan is never flagged as spam.
 *  (2) daily_count + the blocked flag must reset on the SAME Europe/Rome calendar
 *      midnight as messages_sent_today (not a rolling now+24h), so a blocked user
 *      unblocks exactly when their tier quota refills.
 */
import { recordSend, nextRomeMidnightMs, RATE_LIMITS } from '../app/lib/rate-limit';
import { createMockSupabase } from './helpers/mocks';

const USER = '393331234567';
const INST = 'SchedWhats-' + USER;

function romeClock(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(ms));
}

describe('nextRomeMidnightMs', () => {
  test('summer (CEST, UTC+2): next Rome midnight is 22:00Z', () => {
    expect(nextRomeMidnightMs(Date.parse('2026-07-15T10:00:00Z'))).toBe(Date.parse('2026-07-15T22:00:00Z'));
  });

  test('winter (CET, UTC+1): next Rome midnight is 23:00Z', () => {
    expect(nextRomeMidnightMs(Date.parse('2026-01-15T10:00:00Z'))).toBe(Date.parse('2026-01-15T23:00:00Z'));
  });

  test('across the autumn fall-back: lands on the CET midnight', () => {
    // 2026-10-24T23:00Z = Rome 2026-10-25 01:00 CEST; next midnight is 2026-10-26 00:00 CET.
    expect(nextRomeMidnightMs(Date.parse('2026-10-24T23:00:00Z'))).toBe(Date.parse('2026-10-25T23:00:00Z'));
  });

  test('just before Rome midnight rolls to the very next midnight', () => {
    // Rome 23:59 CEST on Jul 15 -> Jul 16 00:00 = 22:00Z (one minute later).
    expect(nextRomeMidnightMs(Date.parse('2026-07-15T21:59:00Z'))).toBe(Date.parse('2026-07-15T22:00:00Z'));
  });

  test('result is always a Rome wall-clock midnight', () => {
    for (const iso of ['2026-03-29T05:00:00Z', '2026-06-01T00:30:00Z', '2026-12-31T23:30:00Z']) {
      expect(romeClock(nextRomeMidnightMs(Date.parse(iso)))).toBe('00:00:00');
    }
  });
});

describe('recordSend — H11(1) anti-spam threshold vs tier cap', () => {
  test('a Business user at 50 sends/day is NOT spam-blocked (50 < SPAM_THRESHOLD)', async () => {
    const mock = createMockSupabase();
    mock.setRpcResponse('rate_limit_record', {
      key: 'user:' + USER, daily_count: 50, blocked: false,
      minute_count: 1, minute_reset: 0, daily_reset: 0, block_reason: null,
    });
    await recordSend(mock.client as any, USER, INST);
    expect(mock.calls.find((c) => c.operation === 'rate_limit_mark_blocked')).toBeUndefined();
  });

  test('genuine abuse at the hard daily ceiling (100) DOES block, keyed by user', async () => {
    const mock = createMockSupabase();
    mock.setRpcResponse('rate_limit_record', {
      key: 'user:' + USER, daily_count: RATE_LIMITS.SPAM_THRESHOLD, blocked: false,
      minute_count: 1, minute_reset: 0, daily_reset: 0, block_reason: null,
    });
    await recordSend(mock.client as any, USER, INST);
    const mb = mock.calls.find((c) => c.operation === 'rate_limit_mark_blocked');
    expect(mb).toBeDefined();
    expect(mb!.args[0].p_key).toBe('user:' + USER);
  });

  test('SPAM_THRESHOLD sits above the highest tier cap', () => {
    expect(RATE_LIMITS.SPAM_THRESHOLD).toBeGreaterThan(50); // Business = 50/day
  });
});

describe('recordSend — H11(2) reset aligned to Rome midnight', () => {
  test('persists p_daily_reset as the next Rome calendar midnight, not a rolling now+24h', async () => {
    const mock = createMockSupabase();
    mock.setRpcResponse('rate_limit_record', {
      key: 'user:' + USER, daily_count: 1, blocked: false,
      minute_count: 1, minute_reset: 0, daily_reset: 0, block_reason: null,
    });
    const before = Date.now();
    await recordSend(mock.client as any, USER, INST);

    const rec = mock.calls.find((c) => c.operation === 'rate_limit_record');
    const dailyReset = rec!.args[0].p_daily_reset as number;
    expect(romeClock(dailyReset)).toBe('00:00:00'); // a Rome midnight (now+24h would be the current wall-clock)
    expect(dailyReset).toBeGreaterThan(before);     // and in the future
  });
});
