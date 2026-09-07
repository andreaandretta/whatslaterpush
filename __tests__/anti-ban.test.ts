/**
 * Guardrail anti-ban puri (app/lib/anti-ban.ts). Settembre = ora legale
 * (Roma = UTC+2): 08:00 Roma = 06:00Z, 20:00 Roma = 18:00Z, 21:00 Roma = 19:00Z.
 */
import {
  applyCourtesyWindow,
  isWithinCourtesyWindow,
  spreadCoTimed,
  warmupDailyCap,
  effectiveDailyLimit,
  countNewRecipients,
  nextRomeMorning,
  romeDayStart,
  isSamePhone,
  WARMUP_RAMP,
} from '../app/lib/anti-ban';

const iso = (d: Date | null) => d && d.toISOString();

describe('applyCourtesyWindow (08-21 Roma, solo invii automatici)', () => {
  const now = new Date('2026-09-09T10:00:00Z'); // 12:00 Roma

  test('dentro la fascia → invariato', () => {
    const d = new Date('2026-09-10T10:00:00Z'); // 12:00 Roma
    expect(applyCourtesyWindow(d, now)).toBe(d);
    expect(isWithinCourtesyWindow(d)).toBe(true);
  });

  test('bordi: 08:00 dentro, 21:00 fuori', () => {
    expect(isWithinCourtesyWindow(new Date('2026-09-10T06:00:00Z'))).toBe(true);  // 08:00 Roma
    expect(isWithinCourtesyWindow(new Date('2026-09-10T19:00:00Z'))).toBe(false); // 21:00 Roma
    expect(isWithinCourtesyWindow(new Date('2026-09-10T18:59:00Z'))).toBe(true);  // 20:59 Roma
  });

  test('troppo presto (06:00) con evento alle 10:00 → le 08:00 dello stesso giorno', () => {
    const r = applyCourtesyWindow(new Date('2026-09-10T04:00:00Z'), now, new Date('2026-09-10T08:00:00Z'));
    expect(iso(r)).toBe('2026-09-10T06:00:00.000Z');
  });

  test('troppo presto e le 08:00 sono troppo vicine all\'evento (07:00) → le 20:00 della sera prima', () => {
    const r = applyCourtesyWindow(new Date('2026-09-10T04:00:00Z'), now, new Date('2026-09-10T05:00:00Z'));
    expect(iso(r)).toBe('2026-09-09T18:00:00.000Z');
  });

  test('nessun candidato valido (sera prima già passata, 08:00 dopo l\'evento) → orario originale', () => {
    const late = new Date('2026-09-09T20:00:00Z'); // 22:00 Roma del 9
    const d = new Date('2026-09-10T04:00:00Z');
    const r = applyCourtesyWindow(d, late, new Date('2026-09-10T05:00:00Z'));
    expect(r).toBe(d);
  });

  test('troppo tardi (22:30) con evento domattina → le 20:00 dello stesso giorno', () => {
    const r = applyCourtesyWindow(new Date('2026-09-10T20:30:00Z'), now, new Date('2026-09-11T07:00:00Z'));
    expect(iso(r)).toBe('2026-09-10T18:00:00.000Z');
  });

  test('troppo tardi e le 20:00 sono già passate → le 08:00 del giorno dopo (prima dell\'evento delle 09:00)', () => {
    const now2 = new Date('2026-09-10T19:00:00Z'); // 21:00 Roma
    const r = applyCourtesyWindow(new Date('2026-09-10T20:30:00Z'), now2, new Date('2026-09-11T07:00:00Z'));
    expect(iso(r)).toBe('2026-09-11T06:00:00.000Z');
  });

  test('senza evento (riprogrammazione del cron): stesse regole senza il vincolo dei 30 min', () => {
    const r = applyCourtesyWindow(new Date('2026-09-10T04:00:00Z'), now);
    expect(iso(r)).toBe('2026-09-10T06:00:00.000Z');
  });
});

describe('spreadCoTimed (90 s tra promemoria co-orari, deterministico)', () => {
  const t = new Date('2026-09-10T07:00:00Z');
  test('tre allo stesso istante → +0 / +90 s / +180 s in ordine di chiave, ordine di input preservato', () => {
    const out = spreadCoTimed([
      { key: 'c', sendAt: t }, { key: 'a', sendAt: t }, { key: 'b', sendAt: t },
    ]);
    expect(out.map(x => x.key)).toEqual(['c', 'a', 'b']);
    expect(iso(out[1].sendAt)).toBe('2026-09-10T07:00:00.000Z'); // a
    expect(iso(out[2].sendAt)).toBe('2026-09-10T07:01:30.000Z'); // b
    expect(iso(out[0].sendAt)).toBe('2026-09-10T07:03:00.000Z'); // c
  });
  test('istanti diversi → intatti; oggetto singolo → stessa istanza', () => {
    const x = { key: 'x', sendAt: t };
    const y = { key: 'y', sendAt: new Date(t.getTime() + 1000) };
    const out = spreadCoTimed([x, y]);
    expect(out[0]).toBe(x);
    expect(out[1]).toBe(y);
  });
  test('deterministico: due chiamate uguali → stessi istanti', () => {
    const items = [{ key: 'k2', sendAt: t }, { key: 'k1', sendAt: t }];
    expect(spreadCoTimed(items).map(i => iso(i.sendAt))).toEqual(spreadCoTimed(items).map(i => iso(i.sendAt)));
  });
});

describe('warmupDailyCap / effectiveDailyLimit', () => {
  const now = new Date('2026-09-10T10:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  test('rampa 5/5/10/15/25/35 poi cap del piano', () => {
    expect(WARMUP_RAMP).toEqual([5, 5, 10, 15, 25, 35]);
    expect(warmupDailyCap(daysAgo(0), now)).toBe(5);
    expect(warmupDailyCap(daysAgo(1), now)).toBe(5);
    expect(warmupDailyCap(daysAgo(2), now)).toBe(10);
    expect(warmupDailyCap(daysAgo(5), now)).toBe(35);
    expect(warmupDailyCap(daysAgo(6), now)).toBeNull();
  });
  test('senza data di collegamento → nessuna rampa; data nel futuro → giorno 0', () => {
    expect(warmupDailyCap(null, now)).toBeNull();
    expect(warmupDailyCap('non-una-data', now)).toBeNull();
    expect(warmupDailyCap(daysAgo(-1), now)).toBe(5);
  });
  test('il cap effettivo è il minimo tra piano e rampa', () => {
    expect(effectiveDailyLimit(50, daysAgo(2), now)).toBe(10);
    expect(effectiveDailyLimit(3, daysAgo(2), now)).toBe(3);
    expect(effectiveDailyLimit(50, daysAgo(30), now)).toBe(50);
    expect(effectiveDailyLimit(50, null, now)).toBe(50);
  });
});

describe('countNewRecipients', () => {
  test('conta i distinti non conosciuti', () => {
    expect(countNewRecipients(['a', 'b', 'c', 'a'], new Set(['b']))).toBe(2);
    expect(countNewRecipients([], new Set())).toBe(0);
  });
});

describe('nextRomeMorning / romeDayStart', () => {
  test('prima delle 08:00 → oggi alle 08:00; dopo → domani alle 08:00', () => {
    expect(iso(nextRomeMorning(new Date('2026-09-10T04:00:00Z')))).toBe('2026-09-10T06:00:00.000Z');
    expect(iso(nextRomeMorning(new Date('2026-09-10T10:00:00Z')))).toBe('2026-09-11T06:00:00.000Z');
    expect(iso(nextRomeMorning(new Date('2026-09-10T06:00:00Z')))).toBe('2026-09-11T06:00:00.000Z'); // esattamente le 08:00 → domani
  });
  test('inizio del giorno di Roma', () => {
    expect(iso(romeDayStart(new Date('2026-09-10T10:00:00Z')))).toBe('2026-09-09T22:00:00.000Z');
  });
});

describe('isSamePhone', () => {
  test('con e senza prefisso 39', () => {
    expect(isSamePhone('393331234567', '3331234567')).toBe(true);
    expect(isSamePhone('393331234567', '393331234567')).toBe(true);
    expect(isSamePhone('393331234567', '393331234568')).toBe(false);
    expect(isSamePhone('', '3331234567')).toBe(false);
  });
});
