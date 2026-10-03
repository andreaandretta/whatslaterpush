/**
 * Limiti dei primi giorni visibili (rapporto 360 del 30 set, B3/T7).
 *
 * app/lib/daily-limit.ts legge cosa farà il cron, non lo cambia: qui si
 * controlla che il limite sia quello del cron (effectiveDailyLimit, rampa
 * 5/5/10/15/25/35 ∧ piano), che la coda si conti come la svuota il cron
 * (oltre il limite → alle 8 della mattina dopo) e i testi esatti di striscia
 * e avvisi. Orari fissi: "adesso" è sabato 3 ottobre 2026, 12:00 a Roma.
 */
import { effectiveDailyLimit } from '../app/lib/anti-ban';
import {
  dailyLimitNow, buildTodayLimit, forecastQueue, todayStripText, dayFullHint, bigGroupWarmupHint,
  warmupNote, BIG_GROUP_WARMUP_SIZE, type TodayLimit, type QueueRow,
} from '../app/lib/daily-limit';

const NOW = new Date('2026-10-03T10:00:00Z'); // sabato 12:00 a Roma
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Collegato ieri alle 11 di Roma: oggi è il giorno 1 (5 al giorno), domani
// dalle 11 il giorno 2 (10), venerdì 9 dalle 11 il piano pieno.
const PAIRED_YESTERDAY = '2026-10-02T09:00:00.000Z';
const ORIGINAL_ENV = process.env;

beforeEach(() => { process.env = { ...ORIGINAL_ENV }; delete process.env.WARMUP_RAMP_DISABLED; });
afterEach(() => { process.env = ORIGINAL_ENV; });

const pending = (id: string, iso: string): QueueRow => ({ id, status: 'pending', scheduled_at: iso });
const many = (n: number, iso: string, prefix = 'r'): QueueRow[] => Array.from({ length: n }, (_, k) => pending(prefix + k, iso));

function info(over: Partial<TodayLimit> = {}): TodayLimit {
  return {
    limit: 5, plan_limit: 50, sent: 0, queued: 0, later: 0, later_days: 0,
    warmup: true, paired_at: PAIRED_YESTERDAY, day: '2026-10-03', ...over,
  };
}

describe('il limite è quello del cron', () => {
  test('dailyLimitNow = effectiveDailyLimit (rampa ∧ piano) per ogni giorno e piano', () => {
    for (const plan of [3, 20, 35, 50]) {
      for (let d = 0; d <= 8; d++) {
        const paired = new Date(NOW.getTime() - d * DAY - HOUR).toISOString();
        const { limit, inWarmup } = dailyLimitNow(plan, paired, NOW);
        expect(limit).toBe(effectiveDailyLimit(plan, paired, NOW));
        expect(inWarmup).toBe(limit < plan);
      }
    }
  });

  test('rampa 5/5/10/15/25/35 sul piano beta (50)', () => {
    const at = (d: number) => dailyLimitNow(50, new Date(NOW.getTime() - d * DAY - HOUR), NOW).limit;
    expect([0, 1, 2, 3, 4, 5, 6].map(at)).toEqual([5, 5, 10, 15, 25, 35, 50]);
  });

  test('Free (3 al giorno): la rampa non lo abbassa, niente "primi giorni"', () => {
    expect(dailyLimitNow(3, PAIRED_YESTERDAY, NOW)).toEqual({ limit: 3, inWarmup: false });
  });

  test('WARMUP_RAMP_DISABLED=true: il piano pieno da subito, come nel cron', () => {
    process.env.WARMUP_RAMP_DISABLED = 'true';
    expect(dailyLimitNow(50, PAIRED_YESTERDAY, NOW)).toEqual({ limit: 50, inWarmup: false });
  });
});

describe('buildTodayLimit (payload della GET)', () => {
  test('limite di oggi, invii fatti, coda di oggi (anche in ritardo), niente altri stati o giorni', () => {
    const rows: QueueRow[] = [
      pending('oggi-18', '2026-10-03T16:00:00Z'),
      pending('in-ritardo', '2026-10-03T08:00:00Z'),
      pending('domani', '2026-10-04T08:00:00Z'),
      { id: 'in-invio', status: 'processing', scheduled_at: '2026-10-03T10:00:00Z' },
      { id: 'in-pausa', status: 'paused', scheduled_at: '2026-10-03T15:00:00Z' },
      { id: 'partito', status: 'sent', scheduled_at: '2026-10-03T07:00:00Z' },
    ];
    expect(buildTodayLimit({ planLimit: 50, pairedAt: PAIRED_YESTERDAY, sentToday: 2, lastResetDay: '2026-10-03', rows, now: NOW })).toEqual({
      limit: 5, plan_limit: 50, sent: 2, queued: 2, later: 0, later_days: 0,
      warmup: true, paired_at: PAIRED_YESTERDAY, day: '2026-10-03',
    });
  });

  test('contatore di ieri non ancora azzerato (last_daily_reset_at vecchio) → oggi 0 invii', () => {
    const t = buildTodayLimit({ planLimit: 50, pairedAt: PAIRED_YESTERDAY, sentToday: 5, lastResetDay: '2026-10-02', rows: [], now: NOW });
    expect(t.sent).toBe(0);
    const ts = buildTodayLimit({ planLimit: 50, pairedAt: PAIRED_YESTERDAY, sentToday: 5, lastResetDay: '2026-10-02T00:00:00+00:00', rows: [], now: NOW });
    expect(ts.sent).toBe(0);
    expect(buildTodayLimit({ planLimit: 50, pairedAt: PAIRED_YESTERDAY, sentToday: 5, lastResetDay: '2026-10-03', rows: [], now: NOW }).sent).toBe(5);
  });

  test('rampa spenta lato server → paired_at null: anche il browser conta col piano', () => {
    process.env.WARMUP_RAMP_DISABLED = 'true';
    const t = buildTodayLimit({ planLimit: 50, pairedAt: PAIRED_YESTERDAY, sentToday: 0, rows: [], now: NOW });
    expect(t).toMatchObject({ limit: 50, warmup: false, paired_at: null });
    expect(dayFullHint(t, many(10, '2026-10-03T16:00:00Z'), new Date('2026-10-03T17:00:00Z'), NOW)).toBeNull();
  });

  test('numero senza data di collegamento → piano pieno', () => {
    expect(buildTodayLimit({ planLimit: 50, pairedAt: null, sentToday: 0, rows: [], now: NOW })).toMatchObject({ limit: 50, warmup: false, paired_at: null });
  });
});

describe('la coda si svuota come la svuota il cron', () => {
  test('primo giorno, convocazione ai 15 genitori alle 18: 5 oggi, 5 domani, 5 dopodomani', () => {
    const f = forecastQueue(info(), many(15, '2026-10-03T16:00:00Z'), NOW);
    expect(f).toMatchObject({ today: 5, queued: 15, later: 10, laterDays: 2 });
  });

  test('il messaggio in modifica non conta due volte', () => {
    const rows = many(5, '2026-10-03T16:00:00Z');
    expect(dayFullHint(info(), rows, new Date('2026-10-03T17:00:00Z'), NOW)).not.toBeNull();
    expect(dayFullHint(info(), rows, new Date('2026-10-03T17:00:00Z'), NOW, 'r0')).toBeNull();
  });

  test('oltre il limite prima delle 8: il cron li rimanda alle 8 di OGGI e lì ricontrolla (la rampa può essere salita)', () => {
    // Collegato il 1 ott alle 07:30 di Roma; adesso è il 3 ott alle 02:30: limite 5,
    // che alle 07:30 sale a 10. Sei messaggi alle 06:00: 5 alle 6, il sesto alle 8 di oggi.
    const paired = '2026-10-01T05:30:00.000Z';
    const night = new Date('2026-10-03T00:30:00Z');
    const rows = many(6, '2026-10-03T04:00:00Z');
    expect(forecastQueue({ plan_limit: 50, paired_at: paired, sent: 0, day: '2026-10-03' }, rows, night)).toMatchObject({ today: 6, queued: 6, later: 0, laterDays: 0 });
    const t = buildTodayLimit({ planLimit: 50, pairedAt: paired, sentToday: 0, lastResetDay: '2026-10-03', rows, now: night });
    expect(t).toMatchObject({ limit: 5, later: 0 });
    expect(todayStripText(t, night)).toMatchObject({ main: 'Oggi partono 6 messaggi', detail: '(massimo 10 oggi)' });
    // Il messaggio nuovo alle 06:00 parte oggi alle 8 (stesso giorno): nessun avviso.
    expect(dayFullHint(t, rows, new Date('2026-10-03T04:00:00Z'), night)).toBeNull();
  });

  test('oltre il limite prima delle 8 e la rampa NON sale prima delle 8: alle 8 il limite è ancora pieno → domattina', () => {
    // Collegato il 1 ott alle 09:00 di Roma: oggi il limite passa a 10 solo alle 9.
    const paired = '2026-10-01T07:00:00.000Z';
    const night = new Date('2026-10-03T00:30:00Z');
    const rows = many(6, '2026-10-03T04:00:00Z');
    expect(forecastQueue({ plan_limit: 50, paired_at: paired, sent: 0, day: '2026-10-03' }, rows, night)).toMatchObject({ today: 5, later: 1, laterDays: 1 });
    const t = buildTodayLimit({ planLimit: 50, pairedAt: paired, sentToday: 0, lastResetDay: '2026-10-03', rows, now: night });
    expect(todayStripText(t, night).main).toBe('Oggi partono 5 messaggi, il massimo di oggi · un altro partirà domattina');
  });

  test('i messaggi dopo l\'orario scelto non lo spingono via (il cron va in ordine di orario)', () => {
    expect(dayFullHint(info(), many(5, '2026-10-03T18:00:00Z'), new Date('2026-10-03T17:00:00Z'), NOW)).toBeNull();
  });
});

describe('striscia in alto in dashboard', () => {
  test('"Oggi partono 2 messaggi (massimo 5 oggi)" + la nota dei primi giorni', () => {
    expect(todayStripText(info({ sent: 2 }), NOW)).toEqual({
      main: 'Oggi partono 2 messaggi',
      detail: '(massimo 5 oggi)',
      note: 'nei primi giorni dopo il collegamento il limite è più basso e sale piano piano fino a 50',
    });
    // Niente più "sale ogni giorno": la rampa è 5, 5, 10… (le prime 48 ore resta 5).
    expect(warmupNote(50)).not.toMatch(/ogni giorno/);
  });

  test('singolare: "Oggi parte 1 messaggio"', () => {
    expect(todayStripText(info({ sent: 0, queued: 1 }), NOW)).toMatchObject({ main: 'Oggi parte 1 messaggio', detail: '(massimo 5 oggi)' });
  });

  test('mai "2 di 5": c\'è sempre l\'unità', () => {
    for (const sent of [0, 1, 2, 5]) expect(todayStripText(info({ sent }), NOW).main).not.toMatch(/\d+ di \d+/);
  });

  test('più del limite: dice quanti slittano e quando', () => {
    const t = buildTodayLimit({ planLimit: 50, pairedAt: PAIRED_YESTERDAY, sentToday: 0, lastResetDay: '2026-10-03', rows: many(15, '2026-10-03T16:00:00Z'), now: NOW });
    expect(todayStripText(t, NOW)).toEqual({
      main: 'Oggi partono 5 messaggi, il massimo di oggi · altri 10 partiranno da domattina, un po\' alla volta',
      detail: null,
      note: 'nei primi giorni dopo il collegamento il limite è più basso e sale piano piano fino a 50',
    });
    const one = buildTodayLimit({ planLimit: 50, pairedAt: PAIRED_YESTERDAY, sentToday: 3, lastResetDay: '2026-10-03', rows: many(3, '2026-10-03T16:00:00Z'), now: NOW });
    expect(todayStripText(one, NOW).main).toBe('Oggi partono 5 messaggi, il massimo di oggi · un altro partirà domattina');
    const two = buildTodayLimit({ planLimit: 50, pairedAt: PAIRED_YESTERDAY, sentToday: 3, lastResetDay: '2026-10-03', rows: many(4, '2026-10-03T16:00:00Z'), now: NOW });
    expect(todayStripText(two, NOW).main).toBe('Oggi partono 5 messaggi, il massimo di oggi · altri 2 partiranno domattina');
  });

  test('a regime: niente nota, il limite del piano come prima ("fino a 50 al giorno")', () => {
    expect(todayStripText(info({ limit: 50, warmup: false, paired_at: null, sent: 3 }), NOW)).toEqual({ main: 'Oggi partono 3 messaggi', detail: '(fino a 50 al giorno)', note: null });
  });

  test('la rampa sale nel pomeriggio: si mostra il limite di stasera, mai "7 di 5"', () => {
    // Collegato l'altro ieri alle 14 di Roma: fino alle 14 di oggi 5, poi 10.
    const paired = '2026-10-01T12:00:00.000Z';
    const morning = new Date('2026-10-03T07:00:00Z'); // 09:00 a Roma
    const t = buildTodayLimit({ planLimit: 50, pairedAt: paired, sentToday: 4, lastResetDay: '2026-10-03', rows: many(3, '2026-10-03T15:00:00Z'), now: morning });
    expect(t.limit).toBe(5);
    expect(todayStripText(t, morning)).toMatchObject({ main: 'Oggi partono 7 messaggi', detail: '(massimo 10 oggi)' });
  });
});

describe('avviso giallo nella finestra del messaggio', () => {
  test('oggi già usati tutti gli invii → "questo partirà domattina"', () => {
    expect(dayFullHint(info({ sent: 5 }), [], new Date('2026-10-03T17:00:00Z'), NOW))
      .toBe('Questo partirà domattina: oggi hai già mandato 5 messaggi, il limite dei primi giorni.');
  });

  test('oggi la coda arriva già al limite prima di quest\'ora', () => {
    expect(dayFullHint(info({ sent: 2 }), many(3, '2026-10-03T15:00:00Z'), new Date('2026-10-03T17:00:00Z'), NOW))
      .toBe('Questo partirà domattina: oggi partono già 5 messaggi, il limite dei primi giorni.');
  });

  test('spazio libero → nessun avviso', () => {
    expect(dayFullHint(info({ sent: 2 }), many(2, '2026-10-03T15:00:00Z'), new Date('2026-10-03T17:00:00Z'), NOW)).toBeNull();
  });

  test('domani pieno per i messaggi slittati da oggi → "dopodomani mattina"', () => {
    // 5 già partiti, 5 in coda alle 18: slittano a domani alle 8 e riempiono
    // domani fino alle 11 (poi la rampa sale a 10).
    expect(dayFullHint(info({ sent: 5 }), many(5, '2026-10-03T16:00:00Z'), new Date('2026-10-04T08:00:00Z'), NOW))
      .toBe('Questo partirà dopodomani mattina: domani partono già 5 messaggi, il limite dei primi giorni.');
    // Domani alle 18 la rampa è già a 10: c'è posto.
    expect(dayFullHint(info({ sent: 5 }), many(5, '2026-10-03T16:00:00Z'), new Date('2026-10-04T16:00:00Z'), NOW)).toBeNull();
  });

  test('a regime (beta 50, niente rampa): "il massimo del giorno", niente primi giorni', () => {
    expect(dayFullHint(info({ limit: 50, warmup: false, paired_at: null, sent: 50 }), [], new Date('2026-10-03T17:00:00Z'), NOW))
      .toBe('Questo partirà domattina: oggi hai già mandato 50 messaggi, il massimo del giorno.');
  });

  test('senza dati dal server → nessun avviso', () => {
    expect(dayFullHint(null, many(20, '2026-10-03T15:00:00Z'), new Date('2026-10-03T17:00:00Z'), NOW)).toBeNull();
  });

  test('il conteggio di ieri non vale dopo mezzanotte', () => {
    const tomorrowMorning = new Date('2026-10-04T07:00:00Z'); // domenica 09:00 a Roma
    expect(dayFullHint(info({ sent: 5 }), [], new Date('2026-10-04T08:00:00Z'), tomorrowMorning)).toBeNull();
  });
});

describe('gruppi oltre 50 persone nei primi giorni', () => {
  const at = new Date('2026-10-03T16:00:00Z');

  test('gruppo da 60, collegato ieri → partirà venerdì 9 ottobre, verso le 8', () => {
    expect(BIG_GROUP_WARMUP_SIZE).toBe(50);
    expect(bigGroupWarmupHint(info(), 60, at, NOW))
      .toBe('Questo partirà venerdì 9 ottobre, verso le 8: nei primi giorni i gruppi con più di 50 persone aspettano.');
  });

  test('ultimo giorno di rampa → "domani"', () => {
    // Collegato 5 giorni fa alle 7 di Roma: domattina alle 8 la rampa è finita.
    const info5 = info({ paired_at: new Date('2026-09-28T05:00:00Z').toISOString(), limit: 35 });
    expect(bigGroupWarmupHint(info5, 60, at, NOW))
      .toBe('Questo partirà domani, verso le 8: nei primi giorni i gruppi con più di 50 persone aspettano.');
  });

  test('50 persone, numero sconosciuto, dopo la rampa, Free → nessun avviso', () => {
    expect(bigGroupWarmupHint(info(), 50, at, NOW)).toBeNull();
    expect(bigGroupWarmupHint(info(), null, at, NOW)).toBeNull();
    expect(bigGroupWarmupHint(info(), 60, new Date('2026-10-09T16:00:00Z'), NOW)).toBeNull();
    expect(bigGroupWarmupHint(info({ plan_limit: 3, limit: 3, warmup: false }), 60, at, NOW)).toBeNull();
    expect(bigGroupWarmupHint(null, 60, at, NOW)).toBeNull();
  });
});
