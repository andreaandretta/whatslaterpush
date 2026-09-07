/**
 * Guardrail anti-ban condivisi tra il Calendar sync e il cron d'invio.
 * Logica PURA (niente I/O): tutto qui è deterministico e unit-testabile
 * (__tests__/anti-ban.test.ts). L'I/O sta in app/lib/first-contact.ts.
 *
 * Perché esistono (analisi 6-7 set 2026, vault: analisi-rischio-ban-calendar):
 * Meta non vede il consenso del cliente, vede segnali — un primo messaggio a
 * un numero senza chat, tre invii allo stesso secondo, il cap pieno dal primo
 * giorno di un numero appena collegato, un promemoria alle 23:40. Ognuno di
 * questi segnali ha qui un freno, applicato SOLO alle decisioni automatiche
 * del sistema (orari calcolati dal calendario, riprogrammazioni del cron):
 * l'orario scelto a mano dall'utente non viene mai toccato.
 */

// ── Europe/Rome wall-clock (stesso pattern DST-safe di recurrence.ts) ──

export interface RomeParts { y: number; mo: number; dd: number; h: number; mi: number; s: number }

export function romeParts(d: Date): RomeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find(p => p.type === t)!.value);
  return { y: g('year'), mo: g('month'), dd: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
}

/** L'istante UTC il cui orologio di Roma segna esattamente (y, mo, dd, h, mi, s). */
export function romeWallClockToUtc(y: number, mo: number, dd: number, h: number, mi: number, s = 0): Date {
  const guess = Date.UTC(y, mo - 1, dd, h, mi, s);
  const p = romeParts(new Date(guess));
  const romeAsUtc = Date.UTC(p.y, p.mo - 1, p.dd, p.h, p.mi, p.s);
  return new Date(guess - (romeAsUtc - guess));
}

/** Mezzanotte di Roma del giorno (di Roma) in cui cade `d`. */
export function romeDayStart(d: Date): Date {
  const p = romeParts(d);
  return romeWallClockToUtc(p.y, p.mo, p.dd, 0, 0, 0);
}

/**
 * Il prossimo `hour`:00 di Roma strettamente dopo `from`. Sostituisce la
 * riprogrammazione "dopo la mezzanotte" del cron: la quota si azzera a
 * mezzanotte, ma un promemoria che riparte alle 00:07 sveglia il cliente.
 */
export function nextRomeMorning(from: Date, hour = COURTESY_START_HOUR): Date {
  const p = romeParts(from);
  const today = romeWallClockToUtc(p.y, p.mo, p.dd, hour, 0, 0);
  if (today.getTime() > from.getTime()) return today;
  return romeWallClockToUtc(p.y, p.mo, p.dd + 1, hour, 0, 0);
}

// ── 1. Fascia di cortesia 08:00-21:00 (Roma) per gli invii AUTOMATICI ──

export const COURTESY_START_HOUR = 8;
export const COURTESY_END_HOUR = 21;   // esclusivo: le 21:00 sono già "tardi"
export const EVENING_SLOT_HOUR = 20;   // "la sera prima"
const MIN_BEFORE_EVENT_MS = 30 * 60_000;

export function isWithinCourtesyWindow(d: Date): boolean {
  const h = romeParts(d).h;
  return h >= COURTESY_START_HOUR && h < COURTESY_END_HOUR;
}

function acceptable(candidate: Date, now: Date, eventStart?: Date | null): boolean {
  if (candidate.getTime() <= now.getTime()) return false;
  if (eventStart && candidate.getTime() > eventStart.getTime() - MIN_BEFORE_EVENT_MS) return false;
  return true;
}

/**
 * Sposta un invio automatico fuori fascia dentro la fascia, senza mai
 * scavalcare l'evento a cui si riferisce (se c'è: resta ≥30 min prima).
 *  - troppo presto (< 08:00): le 08:00 dello stesso giorno; se sono troppo
 *    vicine all'evento → le 20:00 del giorno prima ("la sera prima").
 *  - troppo tardi (≥ 21:00): le 20:00 dello stesso giorno se sono ancora nel
 *    futuro, altrimenti le 08:00 del giorno dopo (se prima dell'evento).
 * Se nessun candidato è nel futuro e prima dell'evento, l'orario originale
 * resta: meglio un promemoria alle 06:00 che nessun promemoria.
 */
export function applyCourtesyWindow(sendAt: Date, now: Date, eventStart?: Date | null): Date {
  const p = romeParts(sendAt);
  if (p.h >= COURTESY_START_HOUR && p.h < COURTESY_END_HOUR) return sendAt;
  const candidates = p.h < COURTESY_START_HOUR
    ? [romeWallClockToUtc(p.y, p.mo, p.dd, COURTESY_START_HOUR, 0), romeWallClockToUtc(p.y, p.mo, p.dd - 1, EVENING_SLOT_HOUR, 0)]
    : [romeWallClockToUtc(p.y, p.mo, p.dd, EVENING_SLOT_HOUR, 0), romeWallClockToUtc(p.y, p.mo, p.dd + 1, COURTESY_START_HOUR, 0)];
  for (const c of candidates) if (acceptable(c, now, eventStart)) return c;
  return sendAt;
}

// ── 2. Spread deterministico dei co-orari (Calendar sync) ──

export const SPREAD_STEP_MS = 90_000;

/**
 * Tre appuntamenti alle 10:00 non devono diventare tre invii allo stesso
 * secondo (batch da 5 in parallelo, stesso IP). Per ogni istante condiviso:
 * il primo (in ordine di chiave) resta, il secondo +90 s, il terzo +180 s…
 * Deterministico per chiave, così due sync consecutive ricalcolano gli
 * STESSI istanti e non generano UPDATE a vuoto. Ordine di input preservato.
 */
export function spreadCoTimed<T extends { key: string; sendAt: Date }>(items: T[], stepMs = SPREAD_STEP_MS): T[] {
  const groups = new Map<number, T[]>();
  for (const it of items) {
    const t = it.sendAt.getTime();
    const g = groups.get(t);
    if (g) g.push(it); else groups.set(t, [it]);
  }
  const offset = new Map<string, number>();
  groups.forEach((g) => {
    if (g.length < 2) return;
    const sorted = g.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    sorted.forEach((it, i) => offset.set(it.key, i * stepMs));
  });
  return items.map((it) => {
    const o = offset.get(it.key);
    return o ? { ...it, sendAt: new Date(it.sendAt.getTime() + o) } : it;
  });
}

// ── 3. Rampa di warm-up per un numero appena collegato ──

/** Cap effettivo nei primi giorni dal pairing (giorno 0 → indice 0). Dopo: cap del piano. */
export const WARMUP_RAMP = [5, 5, 10, 15, 25, 35];

export function warmupDailyCap(connectedAt: string | Date | null | undefined, now: Date): number | null {
  if (!connectedAt) return null; // righe storiche senza data → nessuna rampa
  const t = new Date(connectedAt).getTime();
  if (isNaN(t)) return null;
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days < 0) return WARMUP_RAMP[0];
  return days < WARMUP_RAMP.length ? WARMUP_RAMP[days] : null;
}

export function effectiveDailyLimit(planLimit: number, connectedAt: string | Date | null | undefined, now: Date): number {
  const ramp = warmupDailyCap(connectedAt, now);
  return ramp === null ? planLimit : Math.min(planLimit, ramp);
}

// ── 4. Corsia lenta per i numeri NUOVI (mai contattati) ──

export const NEW_RECIPIENTS_PER_DAY_DEFAULT = 5;

export function newRecipientsPerDay(): number {
  const n = Number(process.env.NEW_RECIPIENTS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : NEW_RECIPIENTS_PER_DAY_DEFAULT;
}

/**
 * Sorgenti di whatsapp_contacts che provano una relazione esistente: il
 * numero sta nella rubrica del telefono o c'è già una chat. MANUAL (digitato
 * o importato da CSV) NON prova nulla.
 */
export const KNOWN_CONTACT_SOURCES = ['CONTACTS_SET', 'CONTACTS_UPSERT', 'CONTACTS_UPDATE', 'MESSAGING_HISTORY_SET', 'MESSAGES_UPSERT'];

/** Quanti dei destinatari di oggi erano sconosciuti prima di oggi. */
export function countNewRecipients(todayRecipients: Iterable<string>, knownBeforeToday: Set<string>): number {
  let n = 0;
  const seen = new Set<string>();
  for (const r of Array.from(todayRecipients)) {
    if (!r || seen.has(r)) continue;
    seen.add(r);
    if (!knownBeforeToday.has(r)) n++;
  }
  return n;
}

// ── Utilità ──

/** Stesso numero anche se uno dei due porta il prefisso 39 e l'altro no. */
export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (!da || !db) return false;
  return da === db || da === '39' + db || db === '39' + da;
}
