// Helper puri della fase 1b (gruppo "schermate2"): segnaposto dei template,
// orologio di Roma della modale, etichetta "↻ ogni …" della lista.
import { unfilledPlaceholders, unfilledPlaceholderMessage } from '../app/lib/placeholders';
import { romeWallClock, instantFromRomeWallClock } from '../app/lib/rome-time';
import { recurrenceTagLabel } from '../app/lib/schedule-quick';

describe('unfilledPlaceholders', () => {
  test('lists every non-{nome} field once, in order', () => {
    expect(unfilledPlaceholders('Partita {giorno} ore {orario} — {luogo}. {giorno}! Ciao {nome}')).toEqual(['{giorno}', '{orario}', '{luogo}']);
  });
  test('{nome} (any case, with spaces) is not a missing field', () => {
    expect(unfilledPlaceholders('Ciao { Nome }, {NOME}')).toEqual([]);
  });
  test('seed-style names with underscores', () => {
    expect(unfilledPlaceholders('Vedi {link_programma}')).toEqual(['{link_programma}']);
  });
  test('the self-chat [Nome] syntax and plain text are untouched', () => {
    expect(unfilledPlaceholders('[Mario] ciao, ci vediamo alle 18')).toEqual([]);
    expect(unfilledPlaceholders(null)).toEqual([]);
  });
  test('message text', () => {
    expect(unfilledPlaceholderMessage('rata €{importo} il {data}')).toBe('Completa i campi tra parentesi: {importo}, {data}');
    expect(unfilledPlaceholderMessage('ok')).toBeNull();
  });
});

describe('orologio di Roma', () => {
  test('round trip keeps the instant (summer and winter)', () => {
    for (const iso of ['2026-07-10T16:00:00.000Z', '2026-12-10T17:00:00.000Z', '2026-10-25T03:30:00.000Z']) { // le 02:xx del cambio d'ora esistono due volte: ambigue per qualsiasi selettore
      const at = new Date(iso);
      expect(instantFromRomeWallClock(romeWallClock(at)).getTime()).toBe(at.getTime());
    }
  });
  test('the wall clock carries Rome hours', () => {
    // 22:30Z = 00:30 del giorno dopo a Roma (ora legale).
    const w = romeWallClock(new Date('2026-07-13T22:30:00.000Z'));
    expect([w.getDate(), w.getHours(), w.getMinutes()]).toEqual([14, 0, 30]);
  });
});

describe('recurrenceTagLabel', () => {
  test.each([
    ['FREQ=DAILY', 'ogni giorno'],
    ['FREQ=WEEKLY;BYDAY=TU', 'ogni martedì'],
    ['FREQ=WEEKLY;BYDAY=MO,WE', 'ogni lunedì, mercoledì'],
    ['FREQ=MONTHLY;BYMONTHDAY=31', 'il 31 di ogni mese'],
  ])('%s → %s', (rule, label) => {
    expect(recurrenceTagLabel(rule)).toBe(label);
  });
  test('no rule or an unreadable one → null', () => {
    expect(recurrenceTagLabel(null)).toBeNull();
    expect(recurrenceTagLabel('FREQ=YEARLY')).toBeNull();
  });
});
