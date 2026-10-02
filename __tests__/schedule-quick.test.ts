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
  proposedSendTime,
  sendBlockReason,
  dayOfMonthPhrase,
  recurrenceTagLabel,
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

// Rapporto 360, T8 (A3): almeno 30 minuti, sulla mezz'ora, mai di sera tardi.
describe('proposedSendTime', () => {
  const hm = (d: Date) => `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  test('10:59 → 11:30 (prima proponeva le 11:00, che passavano mentre si scriveva)', () => {
    expect(hm(proposedSendTime(at('2026-10-08T10:59:00')))).toBe('8 11:30');
  });

  test('sempre almeno 30 minuti di margine, sulla mezz\'ora', () => {
    for (const t of ['09:00:00', '09:01:00', '09:29:59', '09:30:00', '14:45:10', '18:31:00']) {
      const now = at(`2026-10-08T${t}`);
      const p = proposedSendTime(now);
      expect(p.getTime() - now.getTime()).toBeGreaterThanOrEqual(30 * 60_000);
      expect(p.getTime() - now.getTime()).toBeLessThan(60 * 60_000);
      expect(p.getMinutes() % 30).toBe(0);
      expect(p.getSeconds()).toBe(0);
    }
    expect(hm(proposedSendTime(at('2026-10-08T09:00:00')))).toBe('8 09:30');
    expect(hm(proposedSendTime(at('2026-10-08T09:00:30')))).toBe('8 10:00');
  });

  test('sera: dalle 21 in poi → domani alle 9 (prima: le 22 con l\'avviso giallo)', () => {
    expect(hm(proposedSendTime(at('2026-10-08T20:31:00')))).toBe('9 09:00');
    expect(hm(proposedSendTime(at('2026-10-08T21:09:00')))).toBe('9 09:00');
    expect(hm(proposedSendTime(at('2026-10-08T22:21:00')))).toBe('9 09:00');
    expect(hm(proposedSendTime(at('2026-10-08T23:50:00')))).toBe('9 09:00');
  });

  test('notte → le 9 dello stesso giorno; dalle 7:30 in poi la mezz\'ora vera (dalle 8)', () => {
    expect(hm(proposedSendTime(at('2026-10-09T02:10:00')))).toBe('9 09:00');
    expect(hm(proposedSendTime(at('2026-10-09T07:20:00')))).toBe('9 08:00');
  });

  test('20:00 → 20:30; 20:15 arriverebbe alle 21:00 → domani alle 9', () => {
    expect(hm(proposedSendTime(at('2026-10-08T20:00:00')))).toBe('8 20:30');
    expect(hm(proposedSendTime(at('2026-10-08T20:15:00')))).toBe('9 09:00');
  });

  test('la proposta non fa mai scattare l\'avviso 8-21', () => {
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 17, 44]) {
        const now = at(`2026-10-08T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
        expect(courtesyHint(proposedSendTime(now))).toBeNull();
      }
    }
  });
});

// Rapporto 360, T3 (A2): un motivo per volta, in parole semplici.
describe('sendBlockReason', () => {
  const ok = { validDate: true, validMessage: true, groupNome: false, unfilled: [] as string[] };

  test('null quando si può inviare', () => {
    expect(sendBlockReason(ok)).toBeNull();
  });

  test('un motivo per volta, nell\'ordine: orario, testo, {nome} nel gruppo, campi', () => {
    expect(sendBlockReason({ validDate: false, validMessage: false, groupNome: true, unfilled: ['{giorno}'] }))
      .toBe("L'orario è già passato: tocca l'ora per cambiarla.");
    expect(sendBlockReason({ ...ok, validMessage: false, groupNome: true })).toBe('Scrivi il messaggio o allega un file.');
    expect(sendBlockReason({ ...ok, groupNome: true, unfilled: ['{giorno}'] })).toBe('{nome} non si usa nei gruppi: toglilo dal messaggio.');
    expect(sendBlockReason({ ...ok, unfilled: ['{giorno}', '{luogo}'] })).toBe('Completa: {giorno}, {luogo}');
  });

  // Revisione: se è passato il giorno, cambiare solo l'ora non basta.
  test('giorno passato → "Il giorno è già passato: tocca Oggi o Domani."', () => {
    expect(sendBlockReason({ ...ok, validDate: false, pastDay: true })).toBe('Il giorno è già passato: tocca Oggi o Domani.');
    expect(sendBlockReason({ ...ok, validDate: false, pastDay: false })).toBe("L'orario è già passato: tocca l'ora per cambiarla.");
  });
});

// Rapporto 360, T29 (A5): "l'8 di ogni mese", non "il 8".
describe('dayOfMonthPhrase / recurrenceTagLabel mensile', () => {
  test("l'1, l'8, l'11; il resto con il", () => {
    expect(dayOfMonthPhrase(1)).toBe("l'1");
    expect(dayOfMonthPhrase(8)).toBe("l'8");
    expect(dayOfMonthPhrase(11)).toBe("l'11");
    expect(dayOfMonthPhrase(5)).toBe('il 5');
    expect(dayOfMonthPhrase(18)).toBe('il 18');
    expect(dayOfMonthPhrase(31)).toBe('il 31');
  });

  test('etichetta della lista', () => {
    expect(recurrenceTagLabel('FREQ=MONTHLY;BYMONTHDAY=8')).toBe("l'8 di ogni mese");
    expect(recurrenceTagLabel('FREQ=MONTHLY;BYMONTHDAY=5')).toBe('il 5 di ogni mese');
  });
});
