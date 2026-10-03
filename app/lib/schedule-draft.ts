/**
 * Bozza del messaggio non ancora inviato (ScheduleModal), in sessionStorage.
 *
 * Perché: la modale teneva tutto solo in memoria. Un "Indietro" di troppo, un
 * ricaricamento del service worker dopo un deploy, Android che chiude la scheda
 * in background → testo lungo, data e allegato già caricato persi.
 *
 * sessionStorage (non localStorage): la bozza vive quanto la scheda/app aperta,
 * non resta su un dispositivo condiviso per giorni. Ogni accesso è in try/catch:
 * modalità privata o storage bloccato = niente bozza, mai un crash.
 *
 * Una sola bozza alla volta, legata al NUMERO del contatto: non viene mai
 * proposta per un contatto diverso (il testo per Mario non deve finire a Luigi).
 */
import type { MediaAttachment } from '../../components/schedule/MediaPicker';
import type { RecurrenceValue } from '../../components/schedule/RecurrenceBottomSheet';

export const SCHEDULE_DRAFT_KEY = 'wl_schedule_draft';
/** Oltre un giorno la bozza non è più "quella che stavo scrivendo". */
export const SCHEDULE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ScheduleDraft {
  v: 1;
  contactNumber: string;
  contactName?: string;
  message: string;
  /** Data e ora scelte, ISO. */
  scheduledAt: string;
  recurrence: RecurrenceValue;
  /** Giorni scelti per "ogni settimana" (Date.getDay()); assente nelle bozze vecchie. */
  weekDays?: number[];
  /** Riferimento al file già caricato su Storage (non il file). */
  media: MediaAttachment | null;
  savedAt: number;
}

const RECURRENCES: RecurrenceValue[] = ['none', 'daily', 'weekly', 'monthly'];

function weekDaysOf(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)));
}

function isMedia(m: unknown): m is MediaAttachment {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return typeof o.media_url === 'string' && typeof o.media_filename === 'string'
    && (o.media_type === 'image' || o.media_type === 'video' || o.media_type === 'document' || o.media_type === 'audio');
}

export function saveScheduleDraft(d: Omit<ScheduleDraft, 'v' | 'savedAt'>, now = Date.now()): void {
  try {
    const draft: ScheduleDraft = { ...d, v: 1, savedAt: now };
    window.sessionStorage.setItem(SCHEDULE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // quota piena / storage bloccato: la bozza è un di più, mai un errore.
  }
}

export function clearScheduleDraft(): void {
  try { window.sessionStorage.removeItem(SCHEDULE_DRAFT_KEY); } catch { /* ignore */ }
}

/** La bozza per questo contatto, se c'è, è recente e ha del contenuto. */
export function loadScheduleDraft(contactNumber: string, now = Date.now()): ScheduleDraft | null {
  let raw: string | null = null;
  try { raw = window.sessionStorage.getItem(SCHEDULE_DRAFT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<ScheduleDraft>;
    if (!d || d.v !== 1 || typeof d.contactNumber !== 'string') return null;
    if (d.contactNumber !== contactNumber) return null;
    if (typeof d.savedAt !== 'number' || now - d.savedAt > SCHEDULE_DRAFT_TTL_MS) return null;
    const message = typeof d.message === 'string' ? d.message : '';
    const media = isMedia(d.media) ? d.media : null;
    if (message.trim().length === 0 && !media) return null;
    return {
      v: 1,
      contactNumber: d.contactNumber,
      contactName: typeof d.contactName === 'string' ? d.contactName : undefined,
      message,
      scheduledAt: typeof d.scheduledAt === 'string' ? d.scheduledAt : '',
      recurrence: RECURRENCES.includes(d.recurrence as RecurrenceValue) ? (d.recurrence as RecurrenceValue) : 'none',
      weekDays: weekDaysOf(d.weekDays),
      media,
      savedAt: d.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Data/ora della bozza da ripristinare, solo se è ancora nel futuro (stesso
 * margine di un minuto della modale). Un orario già passato non si ripropone:
 * resta quello di default e l'utente ne sceglie uno nuovo.
 */
export function draftDateTime(d: ScheduleDraft, now = Date.now()): { date: Date; time: string } | null {
  const at = new Date(d.scheduledAt);
  if (isNaN(at.getTime()) || at.getTime() < now + 60_000) return null;
  return { date: at, time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` };
}
