/**
 * Unit tests for the quick-scheduling helpers: snooze one-tap presets
 * (MessageActionsSheet) and the dynamic send CTA / date chips of the
 * ScheduleModal redesign. All pure date functions, DST-safe by construction
 * (they operate on local wall-clock Dates, same as the pickers).
 */
import {
  snoozePlusHour,
  snoozeTonight,
  snoozeTomorrowSameTime,
  formatSendCta,
  quickDateChips,
} from '@/app/lib/schedule-quick';

const at = (iso: string) => new Date(iso);

describe('snoozePlusHour', () => {
  it('adds exactly one hour', () => {
    const d = snoozePlusHour(at('2026-08-22T10:15:00'));
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(15);
  });
});

describe('snoozeTonight', () => {
  it('returns today at 20:00 when invoked in the morning', () => {
    const d = snoozeTonight(at('2026-08-22T10:00:00'));
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(22);
    expect(d!.getHours()).toBe(20);
    expect(d!.getMinutes()).toBe(0);
  });

  it('returns null from 19:00 onwards (too close or past)', () => {
    expect(snoozeTonight(at('2026-08-22T19:00:00'))).toBeNull();
    expect(snoozeTonight(at('2026-08-22T21:30:00'))).toBeNull();
  });
});

describe('snoozeTomorrowSameTime', () => {
  it("moves to tomorrow keeping the message's time of day", () => {
    const d = snoozeTomorrowSameTime(at('2026-08-22T18:30:00'), at('2026-08-22T12:00:00'));
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(30);
  });

  it('is always in the future relative to now', () => {
    const d = snoozeTomorrowSameTime(at('2026-08-20T08:00:00'), at('2026-08-22T23:00:00'));
    expect(d.getTime()).toBeGreaterThan(at('2026-08-22T23:00:00').getTime());
    expect(d.getHours()).toBe(8);
  });
});

describe('formatSendCta', () => {
  const now = at('2026-08-22T10:00:00');

  it('says "oggi" for a same-day schedule', () => {
    expect(formatSendCta(at('2026-08-22T18:30:00'), now)).toBe('Invia oggi alle 18:30');
  });

  it('says "domani" for a next-day schedule', () => {
    expect(formatSendCta(at('2026-08-23T09:00:00'), now)).toBe('Invia domani alle 9:00');
  });

  it('names the weekday for anything later', () => {
    const label = formatSendCta(at('2026-08-25T09:00:00'), now);
    expect(label).toMatch(/^Invia (lun|mar|mer|gio|ven|sab|dom)/);
    expect(label).toContain('25');
    expect(label).toContain('alle 9:00');
  });
});

describe('quickDateChips', () => {
  it('returns Oggi, Domani and a next-week chip', () => {
    const chips = quickDateChips(at('2026-08-22T10:00:00'));
    expect(chips).toHaveLength(3);
    expect(chips[0].label).toBe('Oggi');
    expect(chips[1].label).toBe('Domani');
    expect(chips[1].date.getDate()).toBe(23);
    expect(chips[2].date.getDate()).toBe(29);
    expect(chips[2].label.length).toBeGreaterThan(0);
  });
});
