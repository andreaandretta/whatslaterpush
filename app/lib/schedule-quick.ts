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
import { parseRule } from './recurrence';

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

const WEEKDAYS: Record<string, string> = {
  MO: 'lunedì', TU: 'martedì', WE: 'mercoledì', TH: 'giovedì', FR: 'venerdì', SA: 'sabato', SU: 'domenica',
};

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
    const days = (p.byDay || []).map((d) => WEEKDAYS[d]).filter(Boolean);
    if (days.length === 0) return null;
    return days.length === 1 ? `ogni ${days[0]}` : `ogni ${days.join(', ')}`;
  }
  if (p.freq === 'MONTHLY') return `il ${p.byMonthDay} di ogni mese`;
  return null;
}

export { isSameDay };
