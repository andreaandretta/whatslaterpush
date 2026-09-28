/**
 * Cambi d'ora (revisione 28 set 2026): l'istante si calcola con lo scarto di
 * Roma dell'istante stesso.
 */
import { instantFromRomeWallClock, romeWallClock } from '../app/lib/rome-time';

// Date "fluttuante" con i campi dati, qualunque sia il fuso della macchina.
const wall = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe('instantFromRomeWallClock intorno ai cambi d\'ora', () => {
  test('25 Oct 2026 01:30 (still summer time) is 23:30Z the day before', () => {
    expect(instantFromRomeWallClock(wall(2026, 10, 25, 1, 30)).toISOString()).toBe('2026-10-24T23:30:00.000Z');
  });
  test('28 Mar 2027 01:30 (still winter time) is 00:30Z', () => {
    expect(instantFromRomeWallClock(wall(2027, 3, 28, 1, 30)).toISOString()).toBe('2027-03-28T00:30:00.000Z');
  });
  test('an ordinary day is unchanged (18:00 Rome in September = 16:00Z)', () => {
    expect(instantFromRomeWallClock(wall(2026, 9, 26, 18, 0)).toISOString()).toBe('2026-09-26T16:00:00.000Z');
  });
  test('the repeated 02:30 of 25 Oct keeps the instant being edited', () => {
    for (const iso of ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']) {
      const orig = new Date(iso);
      expect(instantFromRomeWallClock(romeWallClock(orig), orig).toISOString()).toBe(iso);
    }
  });
  test('round trip on every hour of the October change day', () => {
    for (let h = 0; h < 26; h++) {
      const t = new Date(Date.UTC(2026, 9, 24, 20 + h, 15));
      expect(instantFromRomeWallClock(romeWallClock(t), t).getTime()).toBe(t.getTime());
    }
  });
});
