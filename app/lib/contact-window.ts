/**
 * Contact "active window" — the single source of truth for what makes a
 * recipient count toward a plan's contact cap.
 *
 * The cap counts ACTIVE recipients, not lifetime ones. A recipient is active if
 * they have a non-cancelled message that is either still in-flight, or was
 * sent/scheduled within the last 90 days. This stops a Free user from being
 * locked out forever by contacts they messaged once, months ago.
 *
 * Used by all three enforcement sites: POST /api/messages (dashboard) and the
 * two self-chat paths in the webhook (auto-save + vCard), so "one contact"
 * means the same thing everywhere.
 */
export const CONTACT_ACTIVE_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ISO timestamp marking the start of the active window (now − 90 days). Used as
 * a `.gte('created_at', …)` / `.gte('sent_at', …)` floor in Supabase queries.
 */
export function contactActiveCutoffIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - CONTACT_ACTIVE_WINDOW_DAYS * DAY_MS).toISOString();
}

// Terminal-but-past states: they only keep a recipient active while inside the
// window. Everything else (pending, paused, processing, awaiting_*) is in-flight
// and always counts. 'cancelled' never counts.
const TERMINAL_PAST = new Set(['sent', 'failed']);

/**
 * Whether a scheduled_messages row keeps its recipient inside the active window.
 *  - in-flight (any non-terminal, non-cancelled status) → always active
 *  - sent/failed → active only if the anchor (sent_at, else scheduled_at) is
 *    within the last 90 days
 *  - cancelled → never (defensive; callers already filter it out in SQL)
 */
export function isRecipientActive(
  row: { status?: string | null; sent_at?: string | null; scheduled_at?: string | null },
  nowMs: number = Date.now()
): boolean {
  const status = row.status ?? '';
  if (status === 'cancelled') return false;
  if (!TERMINAL_PAST.has(status)) return true;

  const cutoff = nowMs - CONTACT_ACTIVE_WINDOW_DAYS * DAY_MS;
  const anchor = Date.parse(row.sent_at ?? row.scheduled_at ?? '');
  return !Number.isNaN(anchor) && anchor >= cutoff;
}
