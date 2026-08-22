/**
 * Google Calendar sync — PURE logic only (no I/O, no Supabase, no fetch).
 *
 * The sync cron scans upcoming events (now → +14d) of a connected calendar;
 * events containing a phone number become WhatsApp reminders in the EXISTING
 * scheduled_messages pipeline, idempotently per event via calendar_event_key
 * (= connection.id + ':' + event.id — singleEvents expansion gives unique ids
 * per recurring instance). Everything here is deterministic and unit-testable;
 * the route layer owns Google/Supabase I/O.
 */
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { normalizeItalianPhone } from './phone';

// ── Types ──

export interface CalendarEventTime {
  dateTime?: string; // timed event, RFC3339
  date?: string;     // all-day event, YYYY-MM-DD
  timeZone?: string;
}

export interface CalendarEvent {
  id: string;
  status?: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  description?: string;
  location?: string;
  start?: CalendarEventTime;
  // Provenance (security gate): Google auto-adds THIRD-PARTY invites to the
  // primary calendar, so without a check an attacker's invite would make the
  // victim's WhatsApp send attacker-chosen text to attacker-chosen numbers.
  creator?: { self?: boolean };
  organizer?: { self?: boolean };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/**
 * Only auto-schedule events the connected account OWNS (created/organizes) or
 * has EXPLICITLY accepted. Auto-added invites (attendee with responseStatus
 * 'needsAction'/'declined'/'tentative') are never turned into outbound
 * messages — that would let anyone with the user's email drive their WhatsApp.
 */
export function isEventTrusted(event: Pick<CalendarEvent, 'creator' | 'organizer' | 'attendees'>): boolean {
  if (event.creator?.self === true) return true;
  if (event.organizer?.self === true) return true;
  return (event.attendees || []).some((a) => a?.self === true && a.responseStatus === 'accepted');
}

export interface CalendarConnectionLike {
  id: string;
  user_phone: string;
  reminder_offset_minutes: number;
  message_template: string | null;
}

export interface ExistingReminderRow {
  id: string;
  status: string;
  scheduled_at: string;
  parsed_message: string | null;
  calendar_event_key: string;
}

export interface ReminderInsert {
  instance_phone: string;
  recipient_number: string;
  recipient_name: string | null;
  parsed_message: string;
  caption: string;
  status: 'pending';
  scheduled_at: string;
  calendar_event_key: string;
}

export interface ReminderUpdate {
  id: string;
  scheduled_at: string;
  parsed_message: string;
  caption: string;
}

export interface SyncActions {
  inserts: ReminderInsert[];
  updates: ReminderUpdate[];
  cancels: string[]; // row ids → status 'cancelled', error_message 'calendar_event_removed'
  capHit: boolean;   // true when the 100-inserts-per-sync cap truncated (route logs it)
}

export const DEFAULT_REMINDER_TEMPLATE =
  'Ciao {nome}, ti ricordo l\'appuntamento "{evento}" di {data} alle {ora}. A presto!';

// Cap on NEW reminder rows per connection per sync run — a runaway calendar
// (bulk import, 250-event window) must not flood the send queue in one tick.
export const MAX_INSERTS_PER_SYNC = 100;
const MAX_MESSAGE_CHARS = 3500;
const MAX_NAME_CHARS = 100;
const MIN_LEAD_MS = 2 * 60 * 1000;   // send time closer than this to now → clamp
const CLAMP_DELAY_MS = 5 * 60 * 1000; // clamped send time = now + 5min

// Candidate phone runs: 9-19 chars of digits/spaces/separators, optional +.
// Real validity is decided AFTER normalization (10-15 digits), so date-like
// runs ("10/09/2026" → 8 digits) fall out on their own.
const PHONE_CANDIDATE_RE = /(\+?\d[\d\s\-\.\/]{7,17}\d)/g;

// ── Phone extraction ──

export function extractEventPhone(
  event: Pick<CalendarEvent, 'summary' | 'description' | 'location'>,
  normalizeFn: (raw: string) => string = normalizeItalianPhone
): { phone: string; rawMatch: string } | null {
  // First extractable phone wins, in field-priority order.
  for (const field of [event.summary, event.description, event.location]) {
    if (!field) continue;
    const candidates = field.match(PHONE_CANDIDATE_RE) || [];
    for (const raw of candidates) {
      const digits = raw.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) continue; // validatePhone bounds
      const phone = normalizeFn(raw);
      if (phone && /^\d{10,15}$/.test(phone)) {
        return { phone, rawMatch: raw };
      }
    }
  }
  return null;
}

// ── Recipient name ──

export function cleanRecipientName(
  summary: string | null | undefined,
  rawMatch: string | null | undefined
): string | null {
  if (!summary) return null;
  let out = summary;
  if (rawMatch) out = out.split(rawMatch).join(' ');
  out = out
    .replace(/[()]/g, ' ')          // leftover parentheses around the number
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-·,\s]+/, '')       // leading separator runs ("- Mario")
    .replace(/[-·,\s]+$/, '');      // trailing separator runs ("Mario -")
  out = out.slice(0, MAX_NAME_CHARS).trim();
  return out || null;
}

// ── Event start / send time ──

// Europe/Rome wall-clock helpers — same DST-correct pattern as the private
// helpers in recurrence.ts (kept private there; small enough to mirror).
function romeParts(d: Date): { y: number; mo: number; dd: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find(p => p.type === t)!.value);
  return { y: g('year'), mo: g('month'), dd: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
}

function romeWallClockToUtc(y: number, mo: number, dd: number, h: number, mi: number, s: number): Date {
  const guess = Date.UTC(y, mo - 1, dd, h, mi, s);
  const p = romeParts(new Date(guess));
  const romeAsUtc = Date.UTC(p.y, p.mo - 1, p.dd, p.h, p.mi, p.s);
  return new Date(guess - (romeAsUtc - guess));
}

export function eventStartOf(event: Pick<CalendarEvent, 'start'>): Date | null {
  const start = event.start;
  if (!start) return null;
  if (start.dateTime) {
    const d = new Date(start.dateTime);
    return isNaN(d.getTime()) ? null : d;
  }
  if (start.date) {
    // All-day event: treat the start as 09:00 Europe/Rome that day (DST-safe).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start.date);
    if (!m) return null;
    return romeWallClockToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 9, 0, 0);
  }
  return null;
}

export function computeSendAt(eventStart: Date, offsetMinutes: number, now: Date): Date | null {
  if (eventStart.getTime() <= now.getTime()) return null; // event already started → skip
  const sendAt = new Date(eventStart.getTime() - offsetMinutes * 60 * 1000);
  if (sendAt.getTime() < now.getTime() + MIN_LEAD_MS) {
    // Too close (or past) but the event is still ahead → send shortly.
    return new Date(now.getTime() + CLAMP_DELAY_MS);
  }
  return sendAt;
}

// ── Message rendering ──

// Resolves {evento}/{data}/{ora} at SYNC time. {nome} is left UNTOUCHED on
// purpose: the send cron resolves it from recipient_name at send time
// (app/lib/template-variables.ts), like every other queued row.
export function renderReminderTemplate(
  template: string | null | undefined,
  vars: { evento: string; data: string; ora: string }
): string {
  const base = template && template.trim() ? template : DEFAULT_REMINDER_TEMPLATE;
  const out = base
    .replace(/\{\s*evento\s*\}/gi, vars.evento)
    .replace(/\{\s*data\s*\}/gi, vars.data)
    .replace(/\{\s*ora\s*\}/gi, vars.ora);
  return out.slice(0, MAX_MESSAGE_CHARS);
}

// {data}/{ora} must show the EVENT start in Europe/Rome wall-clock regardless
// of the server TZ (Vercel = UTC). We rebuild the Rome components into a
// local pseudo-date so date-fns `format` (local-TZ based) prints Rome values.
function formatEventStartRome(eventStart: Date): { data: string; ora: string } {
  const p = romeParts(eventStart);
  const pseudo = new Date(p.y, p.mo - 1, p.dd, p.h, p.mi, p.s);
  return {
    data: format(pseudo, 'EEE d MMM', { locale: it }),
    ora: format(pseudo, 'H:mm'),
  };
}

// ── Idempotency key ──

export function buildEventKey(connectionId: string, eventId: string): string {
  return `${connectionId}:${eventId}`;
}

// ── Diff: events + existing rows → insert/update/cancel actions ──

const TOUCHABLE_STATUSES = new Set(['pending', 'paused']);

export function diffEventsToActions(args: {
  events: CalendarEvent[];
  existingRows: ExistingReminderRow[];
  connection: CalendarConnectionLike;
  now: Date;
}): SyncActions {
  const { events, existingRows, connection, now } = args;
  const inserts: ReminderInsert[] = [];
  const updates: ReminderUpdate[] = [];
  const cancels: string[] = [];
  let capHit = false;

  const keyPrefix = connection.id + ':';
  const rowByKey = new Map<string, ExistingReminderRow>();
  for (const row of existingRows) {
    // Safety: never act on rows belonging to another connection.
    if (row.calendar_event_key?.startsWith(keyPrefix)) rowByKey.set(row.calendar_event_key, row);
  }

  // "Active" = present in the window and not cancelled. Cancel-detection is
  // strictly about presence: an event that is merely unschedulable right now
  // (no phone, already started, broken start) is NOT treated as removed.
  const activeKeys = new Set<string>();

  for (const event of events) {
    if (!event?.id) continue;
    if (event.status === 'cancelled') continue; // treated as removed below
    const key = buildEventKey(connection.id, event.id);
    activeKeys.add(key);

    // Security gate (review MEDIUM): untrusted events are "unschedulable", not
    // "removed" — they never insert/update, but they don't cancel rows either.
    if (!isEventTrusted(event)) continue;

    const eventStart = eventStartOf(event);
    if (!eventStart) continue;

    const extracted = extractEventPhone(event);
    if (!extracted) continue; // no valid phone → not a reminder candidate

    const sendAt = computeSendAt(eventStart, connection.reminder_offset_minutes, now);
    if (!sendAt) continue; // event already started/past → skip entirely

    const name = cleanRecipientName(event.summary, extracted.rawMatch);
    const { data, ora } = formatEventStartRome(eventStart);
    const text = renderReminderTemplate(connection.message_template, {
      evento: name || 'appuntamento',
      data,
      ora,
    });

    const existing = rowByKey.get(key);
    if (!existing) {
      if (inserts.length >= MAX_INSERTS_PER_SYNC) {
        capHit = true;
        continue;
      }
      inserts.push({
        instance_phone: connection.user_phone,
        recipient_number: extracted.phone,
        recipient_name: name,
        parsed_message: text,
        caption: text,
        status: 'pending',
        scheduled_at: sendAt.toISOString(),
        calendar_event_key: key,
      });
      continue;
    }

    // Existing row: only pending/paused may be re-aligned; NEVER touch rows in
    // other statuses (sent/failed/cancelled/processing stay as they are).
    if (!TOUCHABLE_STATUSES.has(existing.status)) continue;
    const scheduledChanged = new Date(existing.scheduled_at).getTime() !== sendAt.getTime();
    const textChanged = existing.parsed_message !== text;
    if (scheduledChanged || textChanged) {
      updates.push({
        id: existing.id,
        scheduled_at: sendAt.toISOString(),
        parsed_message: text,
        caption: text,
      });
    }
  }

  // Events disappeared from the window (deleted, or status:'cancelled'):
  // cancel only future, still-pending rows.
  // Array.from: il target TS del progetto (ES5 default) non itera le Map direttamente.
  for (const [key, row] of Array.from(rowByKey.entries())) {
    if (activeKeys.has(key)) continue;
    if (row.status !== 'pending') continue;
    if (new Date(row.scheduled_at).getTime() <= now.getTime()) continue;
    cancels.push(row.id);
  }

  return { inserts, updates, cancels, capHit };
}
