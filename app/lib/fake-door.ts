/**
 * Porta finta "foto del calendario" (D14): una scheda in dashboard chiede
 * quante date ha il calendario della stagione, per misurare l'interesse
 * prima di costruire la funzione. Logica pura; l'I/O sta in /api/feedback.
 *
 * Attiva solo se FAKE_DOOR_CALENDAR_UNTIL=AAAA-MM-GG è impostata e la data
 * di Roma di oggi non la supera. Variabile assente o malformata → spenta.
 */
import { romeParts } from './anti-ban';

export const FAKE_DOOR_FEATURE = 'calendar_photo';
// 'no' = "Non mi serve": senza, chi non è interessato toccherebbe una risposta a caso.
export const FAKE_DOOR_ANSWERS = ['lt10', '10_30', 'gt30', 'no'] as const;
export type FakeDoorAnswer = typeof FAKE_DOOR_ANSWERS[number];

export function isFakeDoorAnswer(v: unknown): v is FakeDoorAnswer {
  return typeof v === 'string' && (FAKE_DOOR_ANSWERS as readonly string[]).indexOf(v) !== -1;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function isFakeDoorActive(now = new Date()): boolean {
  const until = (process.env.FAKE_DOOR_CALENDAR_UNTIL || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until);
  if (!m) return false;
  const mo = Number(m[2]);
  const dd = Number(m[3]);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return false;
  const p = romeParts(now);
  // Confronto tra stringhe AAAA-MM-GG: l'ordine lessicografico è quello delle date.
  return `${p.y}-${pad2(p.mo)}-${pad2(p.dd)}` <= until;
}
