/**
 * Quick-scheduling helpers: snooze one-tap presets (MessageActionsSheet) and
 * the dynamic send CTA / relative date chips of the ScheduleModal redesign.
 *
 * All functions are pure and operate on local wall-clock Dates — the same
 * frame the pickers use — so no timezone conversion happens here. The PATCH
 * endpoint enforces "at least 60s in the future"; snoozeTonight returns null
 * from 19:00 to keep a comfortable margin instead of failing at the API.
 * Snooze = l'orario scelto dall'utente: la fascia 08-21 NON si applica qui.
 *
 * ScheduleModal passa a formatSendCta/courtesyHint/quickDateChips l'orologio
 * di ROMA (romeWallClock, app/lib/rome-time.ts): così con il telefono in un
 * altro fuso la CTA e l'avviso 08-21 parlano la stessa ora del cron.
 */
import { addDays, addHours, isSameDay, format } from 'date-fns';
import { it } from 'date-fns/locale';
import { parseRule, reconcileRecurringChain } from './recurrence';

// "Posticipa" deve SEMPRE spostare in avanti rispetto all'orario del messaggio.
// Prima i preset partivano da ADESSO: lunedì, "+1 ora" su una convocazione di
// sabato 18:00 la faceva partire lunedì entro l'ora, con il testo di sabato.
// La base è quindi max(adesso, orario programmato): un messaggio già in ritardo
// (es. WhatsApp scollegato) si sposta da adesso, uno futuro dal suo orario.
function snoozeBase(scheduledAt: Date | null | undefined, now: Date): Date {
  if (!scheduledAt || isNaN(scheduledAt.getTime())) return new Date(now);
  return scheduledAt.getTime() > now.getTime() ? new Date(scheduledAt) : new Date(now);
}

export function snoozePlusHour(scheduledAt: Date | null | undefined, now: Date): Date {
  return addHours(snoozeBase(scheduledAt, now), 1);
}

/** Oggi alle 20:00, solo se è più tardi dell'orario attuale del messaggio. */
export function snoozeTonight(now: Date, scheduledAt?: Date | null): Date | null {
  if (now.getHours() >= 19) return null;
  const d = new Date(now);
  d.setHours(20, 0, 0, 0);
  if (d.getTime() <= snoozeBase(scheduledAt, now).getTime()) return null;
  return d;
}

/** Il giorno dopo l'orario del messaggio (o dopo oggi, se è già passato), stessa ora. */
export function snoozeTomorrowSameTime(scheduledAt: Date, now: Date): Date {
  const base = snoozeBase(scheduledAt, now);
  const d = addDays(base, 1);
  d.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), 0, 0);
  return d;
}

export interface SnoozeOption {
  label: string;
  date: Date;
}

/**
 * I preset di "Posticipa" per un messaggio: tutti dopo il suo orario attuale e
 * dopo adesso. "Domani stessa ora" si chiama così solo quando il risultato è
 * davvero domani; per un messaggio già spostato più avanti è "+1 giorno".
 */
export function snoozeOptions(scheduledAt: Date | null | undefined, now: Date): SnoozeOption[] {
  const opts: SnoozeOption[] = [{ label: '+1 ora', date: snoozePlusHour(scheduledAt, now) }];
  const tonight = snoozeTonight(now, scheduledAt);
  if (tonight) opts.push({ label: 'Stasera 20:00', date: tonight });
  if (scheduledAt && !isNaN(scheduledAt.getTime())) {
    const next = snoozeTomorrowSameTime(scheduledAt, now);
    opts.push({ label: isSameDay(next, addDays(now, 1)) ? 'Domani stessa ora' : '+1 giorno', date: next });
  }
  return opts;
}

/** "sab 18:00", "domani 9:30", "oggi 20:00": per il toast dopo un posticipo. */
export function formatShortWhen(d: Date, now: Date = new Date()): string {
  const time = format(d, 'H:mm');
  if (isSameDay(d, now)) return `oggi ${time}`;
  if (isSameDay(d, addDays(now, 1))) return `domani ${time}`;
  return `${format(d, 'EEE d MMM', { locale: it })} ${time}`;
}

/**
 * Data e ora di una riga della lista: "sab 4 ott · 18:00" (rapporto 360, T22).
 * Prima "4 ott · 18:00", senza il giorno della settimana: allenatori e
 * catechisti ragionano per giorni ("quello del sabato"). Un altro anno lo dice:
 * "mer 3 giu 2025 · 09:05". `wall` è già l'orologio di Roma (romeWallClock).
 */
export function formatRowWhen(wall: Date, now: Date = new Date()): string {
  const year = wall.getFullYear() !== now.getFullYear() ? ` ${wall.getFullYear()}` : '';
  return `${format(wall, 'EEE d MMM', { locale: it })}${year} · ${format(wall, 'HH:mm')}`;
}

export function formatSendCta(scheduled: Date, now: Date = new Date()): string {
  const time = format(scheduled, 'H:mm');
  if (isSameDay(scheduled, now)) return `Invia oggi alle ${time}`;
  if (isSameDay(scheduled, addDays(now, 1))) return `Invia domani alle ${time}`;
  return `Invia ${format(scheduled, 'EEE d MMM', { locale: it })} alle ${time}`;
}

/**
 * Avviso soft (solo testo, nessun blocco) quando l'orario scelto a mano cade
 * fuori dalla fascia 08-21: l'utente resta libero, ma sa che chi riceve
 * potrebbe dormire. Speculare alla fascia di cortesia degli invii automatici
 * (app/lib/anti-ban.ts), che invece sposta l'orario da sola.
 */
export function courtesyHint(scheduled: Date): string | null {
  const h = scheduled.getHours();
  if (h >= 8 && h < 21) return null;
  return `Alle ${format(scheduled, 'H:mm')} chi riceve potrebbe dormire: i promemoria di solito si mandano tra le 8 e le 21.`;
}

/**
 * Orario proposto all'apertura della modale (orologio di Roma). Almeno 30
 * minuti da adesso, sulla mezz'ora: prima era "la prossima ora tonda" e alle
 * 10:59 proponeva le 11:00, che passavano mentre si scriveva. Se cade dalle 21
 * in poi o prima delle 8, si propongono le 9 del mattino (dopo le 21 = domani).
 */
export function proposedSendTime(now: Date): Date {
  const d = new Date(now);
  // Minuto intero per eccesso, poi +30 e su alla prossima mezz'ora.
  const partial = d.getSeconds() > 0 || d.getMilliseconds() > 0;
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 30 + (partial ? 1 : 0));
  const m = d.getMinutes() % 30;
  if (m) d.setMinutes(d.getMinutes() + 30 - m);
  const h = d.getHours();
  if (h >= 21) {
    const next = addDays(d, 1);
    next.setHours(9, 0, 0, 0);
    return next;
  }
  if (h < 8) d.setHours(9, 0, 0, 0);
  return d;
}

/**
 * Perché il pulsante Invia è spento, un motivo per volta (in ordine: orario,
 * testo, {nome} nel gruppo, campi del modello). null = si può inviare.
 * pastDay: è passato il GIORNO (Modifica di un messaggio in pausa o rimasto
 * indietro): cambiare solo l'ora non basta.
 */
export function sendBlockReason(s: {
  validDate: boolean;
  pastDay?: boolean;
  validMessage: boolean;
  groupNome: boolean;
  unfilled: string[];
}): string | null {
  if (!s.validDate) return s.pastDay ? 'Il giorno è già passato: tocca Oggi o Domani.' : "L'orario è già passato: tocca l'ora per cambiarla.";
  if (!s.validMessage) return 'Scrivi il messaggio o allega un file.';
  if (s.groupNome) return '{nome} non si usa nei gruppi: toglilo dal messaggio.';
  if (s.unfilled.length > 0) return `Completa: ${s.unfilled.join(', ')}`;
  return null;
}

/** "l'1", "l'8", "l'11", altrimenti "il 15": il giorno del mese in una frase. */
export function dayOfMonthPhrase(day: number): string {
  return day === 1 || day === 8 || day === 11 ? `l'${day}` : `il ${day}`;
}

export interface QuickDateChip {
  label: string;
  date: Date;
}

export function quickDateChips(now: Date = new Date()): QuickDateChip[] {
  const nextWeek = addDays(now, 7);
  return [
    { label: 'Oggi', date: new Date(now) },
    { label: 'Domani', date: addDays(now, 1) },
    { label: format(nextWeek, 'EEE d', { locale: it }), date: nextWeek },
  ];
}

// Indice = Date.getDay() (0 = domenica), come i codici BYDAY di recurrence.ts.
const WEEKDAY_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Giorni della settimana in ordine italiano: dal lunedì alla domenica, senza doppioni. */
export function mondayFirst(days: number[]): number[] {
  const set = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => set.has(d));
}

/**
 * "ogni martedì", "ogni lunedì e giovedì", "ogni lunedì, mercoledì e venerdì",
 * "dal lunedì al venerdì", "ogni giorno" (tutti e sette). Giorni = Date.getDay().
 */
export function weekdaysPhrase(days: number[]): string {
  const ds = mondayFirst(days);
  if (ds.length === 7) return 'ogni giorno';
  if (ds.join(',') === '1,2,3,4,5') return 'dal lunedì al venerdì';
  const names = ds.map((d) => WEEKDAY_NAMES[d]);
  if (names.length <= 1) return `ogni ${names[0] ?? ''}`.trim();
  return `ogni ${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * "ogni martedì", "ogni giorno", "il 5 di ogni mese": etichetta breve della
 * regola per la lista messaggi. Prima la lista non diceva mai che una riga era
 * ricorrente, e "Elimina" fermava la serie senza che l'utente lo sapesse.
 * null = nessuna regola o una regola che non sappiamo leggere.
 */
export function recurrenceTagLabel(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const p = parseRule(rule);
  if (!p) return null;
  if (p.freq === 'DAILY') return 'ogni giorno';
  if (p.freq === 'WEEKLY') {
    const days = (p.byDay || []).map((d) => DAY_CODES.indexOf(d)).filter((d) => d >= 0);
    if (days.length === 0) return null;
    return weekdaysPhrase(days);
  }
  if (p.freq === 'MONTHLY') return `${dayOfMonthPhrase(p.byMonthDay!)} di ogni mese`;
  return null;
}

/**
 * "Riprendi dalla prossima volta" (rapporto 360 B2/T17): per una serie in pausa
 * con l'orario passato, la prima volta della regola dopo adesso, all'ora
 * dell'ancora (l'orario scelto dall'utente, non quello spostato dal cron).
 * È lo stesso calcolo del cron quando crea la volta dopo, e dello "Solo questa
 * volta" dell'Elimina (reconcileRecurringChain): la serie resta com'era, le
 * volte perse si saltano invece di partire tutte insieme. Margine di 2 minuti
 * (il PATCH vuole almeno 60 s nel futuro). null = regola illeggibile o niente
 * prossima volta: si resta alle scelte di prima.
 */
export function resumeNextOccurrence(
  msg: { recurrence_rule?: string | null; scheduled_at?: string | null; recurrence_anchor_at?: string | null },
  nowMs: number = Date.now(),
): Date | null {
  if (!msg.recurrence_rule || !msg.scheduled_at) return null;
  if (isNaN(new Date(msg.scheduled_at).getTime())) return null;
  const anchor = msg.recurrence_anchor_at && !isNaN(new Date(msg.recurrence_anchor_at).getTime())
    ? msg.recurrence_anchor_at
    : null;
  const decision = reconcileRecurringChain({
    hasLiveRow: false,
    latestStatus: 'sent',
    latestScheduledAt: msg.scheduled_at,
    rule: msg.recurrence_rule,
    anchorAt: anchor,
  }, nowMs + 2 * 60_000);
  return decision.insert ? new Date(decision.scheduledAt) : null;
}

export { isSameDay };
