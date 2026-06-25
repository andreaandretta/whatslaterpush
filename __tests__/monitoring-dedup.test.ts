/**
 * Unit tests for the dedup / wording helpers in app/lib/monitoring.ts:
 *   - classifyTransition (onset / escalation / reminder / recovery / none)
 *   - reminderMs (env-tunable re-notification window)
 *   - maskNumber (PII-safe operator alerts)
 *
 * These are the pure functions behind objective 4 ("true dedup": alert once on
 * onset, reminder at most every N hours, Risolto on resolution).
 */

import { classifyTransition, reminderMs, maskNumber } from '../app/lib/monitoring';

describe('classifyTransition', () => {
  test('ok/null -> non-ok = onset (fire immediately)', () => {
    expect(classifyTransition(null, 'critical')).toBe('onset');
    expect(classifyTransition('ok', 'warning')).toBe('onset');
    expect(classifyTransition(undefined, 'critical')).toBe('onset');
  });

  test('weaker -> worse = escalation (bypass dedup)', () => {
    expect(classifyTransition('warning', 'critical')).toBe('escalation');
  });

  test('same / milder non-ok = reminder (rate-limited re-notify)', () => {
    expect(classifyTransition('critical', 'critical')).toBe('reminder');
    expect(classifyTransition('critical', 'warning')).toBe('reminder');
    expect(classifyTransition('warning', 'warning')).toBe('reminder');
  });

  test('non-ok -> ok = recovery', () => {
    expect(classifyTransition('critical', 'ok')).toBe('recovery');
    expect(classifyTransition('warning', 'ok')).toBe('recovery');
  });

  test('ok -> ok (or null -> ok) = none', () => {
    expect(classifyTransition('ok', 'ok')).toBe('none');
    expect(classifyTransition(null, 'ok')).toBe('none');
  });
});

describe('reminderMs', () => {
  const ORIG = process.env.MONITORING_REMINDER_HOURS;
  afterEach(() => { process.env.MONITORING_REMINDER_HOURS = ORIG; });

  test('defaults to 6h when unset', () => {
    delete process.env.MONITORING_REMINDER_HOURS;
    expect(reminderMs()).toBe(6 * 60 * 60 * 1000);
  });

  test('honours MONITORING_REMINDER_HOURS', () => {
    process.env.MONITORING_REMINDER_HOURS = '2';
    expect(reminderMs()).toBe(2 * 60 * 60 * 1000);
  });

  test('falls back to 6h on invalid / non-positive values', () => {
    process.env.MONITORING_REMINDER_HOURS = 'abc';
    expect(reminderMs()).toBe(6 * 60 * 60 * 1000);
    process.env.MONITORING_REMINDER_HOURS = '0';
    expect(reminderMs()).toBe(6 * 60 * 60 * 1000);
  });
});

describe('maskNumber', () => {
  test('keeps only the last 4 digits', () => {
    expect(maskNumber('393331112233')).toBe('…2233');
    expect(maskNumber('SchedWhats-393331112233')).toBe('…2233');
  });

  test('handles short / empty / null gracefully (gender-neutral fallback)', () => {
    expect(maskNumber('12')).toBe('…12');
    expect(maskNumber('')).toBe('n/d');
    expect(maskNumber(null)).toBe('n/d');
    expect(maskNumber(undefined)).toBe('n/d');
  });
});
