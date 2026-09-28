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
  courtesyHint,
  snoozeOptions,
  formatShortWhen,
} from '@/app/lib/schedule-quick';

const at = (iso: string) => new Date(iso);

describe('snoozePlusHour', () => {
  it('adds exactly one hour to an overdue message (base = now)', () => {
    const d = snoozePlusHour(at('2026-08-22T09:00:00'), at('2026-08-22T10:15:00'));
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(15);
  });

  it('adds one hour to the MESSAGE time when it is in the future', () => {
    const d = snoozePlusHour(at('2026-08-29T18:00:00'), at('2026-08-24T10:15:00'));
    expect(d.getDate()).toBe(29);
    expect(d.getHours()).toBe(19);
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


describe('courtesyHint (avviso soft fuori 08-21, ora locale)', () => {
  const local = (h: number, m = 0) => new Date(2026, 8, 10, h, m, 0, 0);
  test('dentro la fascia → null', () => {
    expect(courtesyHint(local(8))).toBeNull();
    expect(courtesyHint(local(20, 59))).toBeNull();
  });
  test('fuori fascia → frase con l\'orario, nessun blocco', () => {
    expect(courtesyHint(local(23, 10))).toContain('23:10');
    expect(courtesyHint(local(7, 30))).toContain('7:30');
    expect(courtesyHint(local(21))).not.toBeNull();
  });
});


// Scenario reale (brief schermate): lunedì l'allenatore apre "Posticipa" su una
// convocazione di sabato 18:00. Prima i tre preset partivano da ADESSO e il
// messaggio usciva lunedì, con il testo di sabato.
describe('snoozeOptions — Posticipa non anticipa mai', () => {
  const monday = at('2026-08-24T10:00:00');
  const saturday = at('2026-08-29T18:00:00');

  it('every preset is later than the current scheduled time and than now', () => {
    const opts = snoozeOptions(saturday, monday);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.date.getTime()).toBeGreaterThan(saturday.getTime());
      expect(o.date.getTime()).toBeGreaterThan(monday.getTime());
    }
  });

  it('hides "Stasera" when tonight is not later than the message', () => {
    const labels = snoozeOptions(saturday, monday).map((o) => o.label);
    expect(labels).not.toContain('Stasera 20:00');
  });

  it('a message days away gets "+1 giorno" (Sunday 18:00), not "Domani"', () => {
    const day = snoozeOptions(saturday, monday).find((o) => o.label === '+1 giorno');
    expect(day).toBeDefined();
    expect(day!.date.getDate()).toBe(30);
    expect(day!.date.getHours()).toBe(18);
  });

  it('a message due today keeps Stasera and "Domani stessa ora"', () => {
    const labels = snoozeOptions(at('2026-08-24T12:00:00'), monday).map((o) => o.label);
    expect(labels).toEqual(['+1 ora', 'Stasera 20:00', 'Domani stessa ora']);
  });

  it('an overdue message (e.g. held while disconnected) moves from now', () => {
    const opts = snoozeOptions(at('2026-08-20T08:00:00'), monday);
    for (const o of opts) expect(o.date.getTime()).toBeGreaterThan(monday.getTime());
  });

  it('holds for many message/now combinations', () => {
    const nows = [at('2026-08-24T07:00:00'), at('2026-08-24T18:59:00'), at('2026-08-24T23:30:00')];
    const offsetsH = [-30, -1, 0.5, 2, 9, 30, 24 * 6];
    for (const now of nows) {
      for (const h of offsetsH) {
        const sched = new Date(now.getTime() + h * 3600_000);
        for (const o of snoozeOptions(sched, now)) {
          expect(o.date.getTime()).toBeGreaterThan(Math.max(sched.getTime(), now.getTime()));
        }
      }
    }
  });
});

describe('formatShortWhen', () => {
  it('names today/tomorrow, otherwise the weekday', () => {
    const now = at('2026-08-24T10:00:00');
    expect(formatShortWhen(at('2026-08-24T20:00:00'), now)).toBe('oggi 20:00');
    expect(formatShortWhen(at('2026-08-25T09:30:00'), now)).toBe('domani 9:30');
    expect(formatShortWhen(at('2026-08-29T19:00:00'), now)).toMatch(/^sab 29 ago 19:00$/);
  });
});
