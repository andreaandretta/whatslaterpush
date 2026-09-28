/**
 * Ora italiana nella modale di programmazione.
 *
 * Il server ragiona in Europe/Rome: nextOccurrence (recurrence.ts) prende
 * giorno della settimana e ora da Roma, la fascia di cortesia del cron è
 * 08-21 Roma. La modale invece costruiva data, ora e regola col fuso del
 * telefono: un "ogni lunedì 23:30" scelto da Lisbona è martedì 00:30 a Roma,
 * e dalla seconda volta partiva lunedì 00:30 Roma (domenica sera per l'utente).
 *
 * Soluzione: i selettori della modale lavorano su un orologio "fluttuante",
 * cioè un Date locale i cui campi (anno, mese, giorno, ore, minuti) SONO
 * l'ora di Roma. getDay()/getDate()/getHours() su quel Date danno quindi il
 * giorno e l'ora italiani, e buildRRule/recurrenceLabel/courtesyHint funzionano
 * senza modifiche. Solo all'invio lo si converte nell'istante vero.
 * Con il telefono in ora italiana (tutti gli utenti oggi) le due cose coincidono.
 */

export const ROME_TZ = 'Europe/Rome';

function romeParts(d: Date): { y: number; mo: number; dd: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ROME_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: g('year'), mo: g('month'), dd: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
}

/** true quando il telefono NON è in ora italiana: la modale lo dice ("Orari in ora italiana"). */
export function browserIsOutsideRome(): boolean {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone !== ROME_TZ;
  } catch {
    return false;
  }
}

/** Istante vero → Date locale i cui campi sono l'ora di Roma (per i selettori). */
export function romeWallClock(instant: Date): Date {
  const p = romeParts(instant);
  return new Date(p.y, p.mo - 1, p.dd, p.h, p.mi, p.s, 0);
}

/**
 * Date "fluttuante" (campi = ora di Roma) → istante vero. Inverso di romeWallClock.
 * Lo scarto di Roma si misura all'istante cercato, non ai campi letti come UTC
 * (revisione 28 set 2026: l'01:30 del 25 ottobre usciva un'ora dopo). Nell'ora
 * che il 25 ottobre capita due volte vale `prefer` se è una delle due (modifica
 * di un messaggio esistente: non lo sposta), altrimenti la prima.
 */
export function instantFromRomeWallClock(wall: Date, prefer?: Date): Date {
  const target = Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds());
  const offsetAt = (t: number) => {
    const p = romeParts(new Date(t));
    return Date.UTC(p.y, p.mo - 1, p.dd, p.h, p.mi, p.s) - t;
  };
  const HOUR = 3600_000;
  const cands = Array.from(new Set([target - offsetAt(target - 3 * HOUR), target - offsetAt(target + 3 * HOUR)]))
    .filter((t) => t + offsetAt(t) === target)
    .sort((a, b) => a - b);
  if (cands.length === 0) {
    // Ora che non esiste (salto in avanti di marzo): due passaggi.
    const t1 = target - offsetAt(target);
    return new Date(target - offsetAt(t1));
  }
  if (prefer && !isNaN(prefer.getTime())) {
    const hit = cands.find((t) => Math.abs(t - prefer.getTime()) < 60_000);
    if (hit !== undefined) return new Date(hit);
  }
  return new Date(cands[0]);
}
