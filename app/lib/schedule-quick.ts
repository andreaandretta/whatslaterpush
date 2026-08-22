/**
 * Quick-scheduling helpers: snooze one-tap presets (MessageActionsSheet) and
 * the dynamic send CTA / relative date chips of the ScheduleModal redesign.
 *
 * All functions are pure and operate on local wall-clock Dates — the same
 * frame the pickers use — so no timezone conversion happens here. The PATCH
 * endpoint enforces "at least 60s in the future"; snoozeTonight returns null
 * from 19:00 to keep a comfortable margin instead of failing at the API.
 */
import { addDays, addHours, isSameDay, format } from 'date-fns';
import { it } from 'date-fns/locale';

export function snoozePlusHour(now: Date): Date {
  return addHours(now, 1);
}

export function snoozeTonight(now: Date): Date | null {
  if (now.getHours() >= 19) return null;
  const d = new Date(now);
  d.setHours(20, 0, 0, 0);
  return d;
}

export function snoozeTomorrowSameTime(scheduledAt: Date, now: Date): Date {
  const d = addDays(now, 1);
  d.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), 0, 0);
  return d;
}

export function formatSendCta(scheduled: Date, now: Date = new Date()): string {
  const time = format(scheduled, 'H:mm');
  if (isSameDay(scheduled, now)) return `Invia oggi alle ${time}`;
  if (isSameDay(scheduled, addDays(now, 1))) return `Invia domani alle ${time}`;
  return `Invia ${format(scheduled, 'EEE d MMM', { locale: it })} alle ${time}`;
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

export { isSameDay };
