/**
 * Il limite d'invio di OGGI, visibile all'utente (rapporto 360 del 30 set, B3/T7).
 *
 * Prima la dashboard diceva "fino a 50 al giorno" anche il giorno dopo il
 * collegamento, quando il cron ne mandava 5: la convocazione delle 18 ai 15
 * genitori partiva per 5, gli altri la ricevevano il giorno dopo, senza
 * preavviso. Qui c'è UNA sola aritmetica, quella del cron: il cron la applica
 * (dailyLimitNow), la GET /api/messages la manda alla dashboard (TodayLimit),
 * striscia e finestra del messaggio la mostrano. Nessuna regola nuova: la
 * rampa resta in anti-ban.ts (effectiveDailyLimit), qui si legge cosa farà il
 * cron, non lo si cambia.
 *
 * Il modulo gira anche nel browser: niente I/O. L'unica env (la rampa spenta)
 * si legge SOLO lato server; la GET la traduce in paired_at = null, così il
 * client, con la stessa funzione, ottiene il limite del piano.
 */
import { effectiveDailyLimit, nextRomeMorning, romeDayStart, romeParts, romeWallClockToUtc } from './anti-ban';

/** Gruppi più grandi di così, nei primi giorni dal collegamento, il cron li rimanda ogni mattina (D9). */
export const BIG_GROUP_WARMUP_SIZE = 50;

/** SOLO SERVER: WARMUP_RAMP_DISABLED=true spegne la rampa dei primi giorni. */
export function warmupRampEnabled(): boolean {
  return process.env.WARMUP_RAMP_DISABLED !== 'true';
}

/** Il limite che il cron applica a un invio fatto ADESSO: rampa dei primi giorni ∧ piano. */
export function dailyLimitNow(planLimit: number, pairedAt: string | Date | null | undefined, now: Date): { limit: number; inWarmup: boolean } {
  const limit = warmupRampEnabled() ? effectiveDailyLimit(planLimit, pairedAt, now) : planLimit;
  return { limit, inWarmup: limit < planLimit };
}

/** Payload `today_limit` della GET /api/messages. */
export interface TodayLimit {
  /** Invii massimi di oggi, adesso (rampa ∧ piano). */
  limit: number;
  /** Limite del piano, quello a regime. */
  plan_limit: number;
  /** Invii già fatti oggi: il contatore che il cron confronta col limite. */
  sent: number;
  /** Messaggi in coda per il resto di oggi (ora di Roma), anche quelli in ritardo. */
  queued: number;
  /** Di questi, quanti il cron sposterà a un altro giorno perché il limite è pieno. */
  later: number;
  /** Fra quanti giorni parte l'ultimo di quelli spostati (1 = domattina). 0 se nessuno. */
  later_days: number;
  /** La rampa dei primi giorni abbassa il limite di adesso. */
  warmup: boolean;
  /** Da quando conta la rampa. null = rampa spenta (o numero senza data): vale il piano. */
  paired_at: string | null;
  /** Giorno di Roma ("YYYY-MM-DD") a cui si riferisce `sent`: dopo mezzanotte non vale più. */
  day: string;
}

/** Il minimo di una riga di scheduled_messages che serve a contare la coda. */
export interface QueueRow {
  id?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
}

function romeNextDayStart(d: Date): Date {
  const p = romeParts(d);
  return romeWallClockToUtc(p.y, p.mo, p.dd + 1, 0, 0, 0);
}

function rowTime(r: QueueRow): number {
  return r.scheduled_at ? new Date(r.scheduled_at).getTime() : NaN;
}

/** "YYYY-MM-DD" del giorno di Roma (stesso formato della colonna date last_daily_reset_at). */
export function romeDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Quanti giorni di Roma separano `d` da `now` (0 = oggi, 1 = domani). */
function romeDayOffset(d: Date, now: Date): number {
  const a = romeParts(romeDayStart(d));
  const b = romeParts(romeDayStart(now));
  return Math.round((Date.UTC(a.y, a.mo - 1, a.dd) - Date.UTC(b.y, b.mo - 1, b.dd)) / 86_400_000);
}

/** Il limite del giorno in un altro istante, con la stessa funzione del cron. */
export function limitAt(info: Pick<TodayLimit, 'plan_limit' | 'paired_at'>, at: Date): number {
  return effectiveDailyLimit(info.plan_limit, info.paired_at, at);
}

/** Gli invii già fatti valgono solo nel giorno in cui la GET li ha letti. */
function sentOn(info: Pick<TodayLimit, 'sent'> & { day?: string }, now: Date): number {
  if (info.day && info.day !== romeDateKey(now)) return 0;
  return Math.max(0, Number(info.sent) || 0);
}

export interface QueueForecast {
  /** Invii di oggi: già fatti + quelli che il cron farà entro mezzanotte. */
  today: number;
  /** Righe in coda per il resto di oggi (anche quelle in ritardo). */
  queued: number;
  /** Di queste, quante il cron sposta a un altro giorno. */
  later: number;
  /** Fra quanti giorni parte l'ultima delle righe spostate (1 = domani). */
  laterDays: number;
  /** Il messaggio "di prova" (quello che si sta programmando): quando parte davvero. */
  probeAt: Date | null;
}

interface SimItem { t: number; probe: boolean; today: boolean }

const MAX_SIM_DAYS = 120;

/**
 * Fa il giro del cron sulla coda, un giorno di Roma alla volta, con le sue
 * regole e nient'altro: le righe partono in ordine di orario (quelle in
 * ritardo adesso); se gli invii del giorno hanno già raggiunto il limite di
 * quel momento (effectiveDailyLimit, come il cron) il cron rimanda la riga a
 * nextRomeMorning(adesso), cioè alle 8:
 *  - prima delle 8 sono le 8 dello STESSO giorno, e lì la riga si ricontrolla
 *    col limite delle 8 (la rampa sale all'ora del collegamento, non a
 *    mezzanotte: può essere salita nel frattempo);
 *  - dalle 8 in poi è la mattina dopo, e lì la riga passa davanti alle righe
 *    di quel giorno (il cron la rimette alle 8 più qualche minuto).
 * Così un primo giorno con 15 genitori risulta 5 oggi, 5 domani, 5 dopodomani.
 *
 * Stima, non promessa: non vede la corsia lenta dei numeri nuovi, il limite
 * dei 3 messaggi per persona, le volte future delle ripetizioni (la riga
 * della volta dopo nasce solo quando parte questa) né i messaggi che il
 * cron non manda perché WhatsApp è scollegato.
 */
export function forecastQueue(
  base: Pick<TodayLimit, 'plan_limit' | 'paired_at' | 'sent'> & { day?: string },
  rows: QueueRow[],
  now: Date,
  probe?: { at: Date; excludeId?: string | null },
): QueueForecast {
  const nowMs = now.getTime();
  const todayEnd = romeNextDayStart(now).getTime();
  const items: SimItem[] = [];
  for (const r of rows) {
    if (r.status !== 'pending') continue; // 'processing' ha già preso il suo posto nel contatore
    if (probe?.excludeId && r.id === probe.excludeId) continue; // in modifica non conta due volte
    const t = rowTime(r);
    if (isNaN(t)) continue;
    const e = Math.max(t, nowMs);
    items.push({ t: e, probe: false, today: e < todayEnd });
  }
  if (probe && !isNaN(probe.at.getTime())) items.push({ t: Math.max(probe.at.getTime(), nowMs), probe: true, today: false });
  // Ordine del cron: scheduled_at crescente. A pari orario il nuovo va dopo (stima prudente).
  items.sort((a, b) => a.t - b.t || Number(a.probe) - Number(b.probe));

  const out: QueueForecast = { today: 0, queued: items.filter((it) => it.today).length, later: 0, laterDays: 0, probeAt: null };
  let dayStart = romeDayStart(now).getTime();
  let dayEnd = todayEnd;
  let count = sentOn(base, now);
  let carry: SimItem[] = [];
  let i = 0;
  for (let guard = 0; guard < MAX_SIM_DAYS; guard++) {
    const isToday = dayStart <= nowMs;
    const morning = Math.max(nextRomeMorning(new Date(dayStart)).getTime(), nowMs);
    // Il cron manda la riga se c'è posto nel limite di quell'istante.
    const send = (it: SimItem): boolean => {
      if (count >= limitAt(base, new Date(it.t))) return false;
      count++;
      if (it.probe) out.probeAt = new Date(it.t);
      else if (it.today && !isToday) out.laterDays = Math.max(out.laterDays, romeDayOffset(new Date(it.t), now));
      return true;
    };
    // Prima delle 8: ciascuna al suo orario; quelle senza posto vanno alle 8 di oggi.
    const retry: SimItem[] = [];
    while (i < items.length && items[i].t < dayEnd && items[i].t < morning) {
      const it = items[i++];
      if (!send(it)) retry.push(it);
    }
    // Alle 8: prima le righe spostate dal giorno prima, poi quelle spostate
    // stamattina, poi il resto del giorno. Chi non ha posto va alla mattina dopo.
    const rest: SimItem[] = [...carry, ...retry].map((it) => ({ ...it, t: morning }));
    while (i < items.length && items[i].t < dayEnd) rest.push(items[i++]);
    carry = [];
    for (const it of rest) {
      if (send(it)) continue;
      if (isToday && !it.probe) out.later++;
      carry.push(it);
    }
    if (isToday) out.today = count;
    const probeDone = !probe || out.probeAt !== null;
    if (probeDone && !carry.some((c) => c.today)) break;
    if (carry.length === 0 && i >= items.length) break;
    // Giorno dopo; senza righe spostate si salta direttamente al giorno della prossima riga.
    const next = carry.length === 0 && i < items.length ? new Date(items[i].t) : new Date(dayEnd);
    dayStart = romeDayStart(next).getTime();
    dayEnd = romeNextDayStart(next).getTime();
    count = 0;
  }
  return out;
}

/**
 * Lato server: compone il payload. `lastResetDay` è last_daily_reset_at: se è
 * di un giorno precedente il contatore è ancora quello di ieri (il cron lo
 * azzera al primo giro di oggi, e claim_daily_quota lo considera già zero),
 * quindi oggi gli invii fatti sono 0.
 */
export function buildTodayLimit(args: {
  planLimit: number;
  pairedAt: string | null | undefined;
  sentToday: number | null | undefined;
  lastResetDay?: string | null;
  rows: QueueRow[];
  now: Date;
}): TodayLimit {
  const { planLimit, pairedAt, rows, now } = args;
  const day = romeDateKey(now);
  const { limit, inWarmup } = dailyLimitNow(planLimit, pairedAt, now);
  const stale = !!args.lastResetDay && String(args.lastResetDay).slice(0, 10) < day;
  const sent = stale ? 0 : Math.max(0, Number(args.sentToday) || 0);
  // Rampa spenta lato server → paired_at null: anche il browser ottiene il piano.
  const paired = warmupRampEnabled() && pairedAt ? String(pairedAt) : null;
  const f = forecastQueue({ plan_limit: planLimit, paired_at: paired, sent, day }, rows, now);
  return {
    limit,
    plan_limit: planLimit,
    sent,
    queued: f.queued,
    later: f.later,
    later_days: f.laterDays,
    warmup: inWarmup,
    paired_at: paired,
    day,
  };
}

// ── Testi ──

const pluralMsg = (n: number) => (n === 1 ? '1 messaggio' : `${n} messaggi`);

/** "sabato 10 ottobre" (ora di Roma). */
function romeLongDay(d: Date): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

/**
 * Nota dei primi giorni. Non "sale ogni giorno": la rampa è 5, 5, 10, 15, 25,
 * 35, quindi per le prime 48 ore resta uguale.
 */
export function warmupNote(planLimit: number): string {
  return `nei primi giorni dopo il collegamento il limite è più basso e sale piano piano fino a ${planLimit}`;
}

export interface TodayStrip {
  /** "Oggi partono 2 messaggi" (bianco). */
  main: string;
  /** "(massimo 5 oggi)" / "(fino a 50 al giorno)" (grigio), o null. */
  detail: string | null;
  /** La nota dei primi giorni (grigio), o null. */
  note: string | null;
}

/**
 * Striscia in alto in dashboard: "Oggi partono 2 messaggi (massimo 5 oggi)"
 * + la nota sui primi giorni. Con l'unità e il "massimo": "2 di 5" si leggeva
 * come "partono 2 dei miei 5 messaggi". Se in coda c'è più del limite lo dice:
 * "Oggi partono 5 messaggi, il massimo di oggi · altri 2 partiranno domattina".
 */
export function todayStripText(info: TodayLimit, now: Date = new Date()): TodayStrip {
  const num = (v: unknown) => Math.max(0, Number(v) || 0);
  const later = num(info.later);
  const today = Math.max(0, num(info.sent) + num(info.queued) - later);
  // La rampa sale a un'ora precisa (24 ore dal collegamento): se oggi ne
  // partono più del limite di adesso è perché più tardi sale. Si mostra quello.
  const cap = today > info.limit ? Math.max(info.limit, limitAt(info, new Date(romeNextDayStart(now).getTime() - 1))) : info.limit;
  let main = `Oggi ${today === 1 ? 'parte 1 messaggio' : `partono ${today} messaggi`}`;
  let detail: string | null = null;
  if (later > 0 && today >= cap) main += ', il massimo di oggi';
  else detail = info.warmup || cap < num(info.plan_limit) ? `(massimo ${cap} oggi)` : `(fino a ${cap} al giorno)`;
  if (later > 0) {
    const soon = (Number(info.later_days) || 1) <= 1;
    main += later === 1
      ? ` · un altro partirà ${soon ? 'domattina' : 'nei prossimi giorni'}`
      : ` · altri ${later} partiranno ${soon ? 'domattina' : 'da domattina, un po\' alla volta'}`;
  }
  return { main, detail, note: info.warmup ? warmupNote(num(info.plan_limit)) : null };
}

/** "domattina", "dopodomani mattina", "la mattina di sabato 10 ottobre". */
function morningLabel(d: Date, now: Date): string {
  const off = romeDayOffset(d, now);
  if (off <= 0) return 'stamattina';
  if (off === 1) return 'domattina';
  if (off === 2) return 'dopodomani mattina';
  return `la mattina di ${romeLongDay(d)}`;
}

/**
 * Avviso giallo nella finestra del messaggio, PRIMA di programmare: il giorno
 * scelto è già pieno e questo messaggio slitterà a una mattina dopo (il cron
 * lo rimanda alle 8 con "Limite giornaliero raggiunto"). Conta come il cron
 * (forecastQueue); il messaggio che si sta modificando non conta due volte.
 */
export function dayFullHint(
  info: TodayLimit | null | undefined,
  rows: QueueRow[],
  at: Date,
  now: Date,
  excludeId?: string | null,
): string | null {
  if (!info || isNaN(at.getTime()) || at.getTime() < now.getTime()) return null;
  const f = forecastQueue(info, rows, now, { at, excludeId });
  if (!f.probeAt || romeDateKey(f.probeAt) === romeDateKey(at)) return null;

  // Prima QUANDO parte (è quello che serve sapere), poi il perché, corto: due
  // righe. La spiegazione lunga dei primi giorni sta nella striscia in alto.
  const limit = limitAt(info, at);
  const when = morningLabel(f.probeAt, now);
  const why = limit < info.plan_limit ? 'il limite dei primi giorni' : 'il massimo del giorno';
  const offset = romeDayOffset(at, now);
  if (offset === 0 && sentOn(info, now) >= limit) {
    return `Questo partirà ${when}: oggi hai già mandato ${pluralMsg(limit)}, ${why}.`;
  }
  const day = offset === 0 ? 'oggi' : offset === 1 ? 'domani' : romeLongDay(at);
  return `Questo partirà ${when}: ${day} ${limit === 1 ? 'parte' : 'partono'} già ${pluralMsg(limit)}, ${why}.`;
}

/**
 * Gruppo con più di 50 persone nei primi giorni dal collegamento: il cron non
 * lo manda e lo rimanda alle 8 di ogni mattina finché la rampa non finisce.
 * Lo si dice prima, con il giorno in cui partirà: la prima mattina in cui il
 * limite è tornato quello del piano (stessa prova del cron, limit < piano).
 */
export function bigGroupWarmupHint(info: TodayLimit | null | undefined, groupSize: number | null | undefined, at: Date, now: Date): string | null {
  if (!info || typeof groupSize !== 'number' || groupSize <= BIG_GROUP_WARMUP_SIZE) return null;
  if (isNaN(at.getTime()) || limitAt(info, at) >= info.plan_limit) return null;
  let from = nextRomeMorning(at);
  for (let k = 0; k < 40 && limitAt(info, from) < info.plan_limit; k++) from = nextRomeMorning(from);
  if (limitAt(info, from) < info.plan_limit) return null;
  const off = romeDayOffset(from, now);
  const label = off <= 0 ? 'oggi' : off === 1 ? 'domani' : off === 2 ? 'dopodomani' : romeLongDay(from);
  return `Questo partirà ${label}, verso le 8: nei primi giorni i gruppi con più di ${BIG_GROUP_WARMUP_SIZE} persone aspettano.`;
}
