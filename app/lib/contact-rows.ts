/**
 * Which address-book numbers must never be offered again (picker, Recents,
 * POST guard). Nothing is deleted: callers only hide or refuse.
 *
 * Server-only on purpose: it pulls libphonenumber's full metadata through
 * app/lib/phone.ts, which the client bundle must not carry for jid.ts users.
 */
import { isLegacyLidRow, LID_INGEST_FIX_AT } from './jid';
import { isPlausibleE164Digits } from './phone';
import { isNotOnWhatsAppError } from './message-error';

type ContactRowLike = { contact_number?: unknown; added_manually?: boolean | null; created_at?: string | null } | null | undefined;

/**
 * A whatsapp_contacts row that is not a phone number: the 14-15 digit LIDs of
 * isLegacyLidRow, plus the shorter ones the digit count missed (13-digit rows
 * like "1542…2503" whose prefix cannot be a number of that length). Same
 * limits as isLegacyLidRow: rows the user typed are trusted, and rows stored
 * after LID_INGEST_FIX_AT come from phone JIDs only, so they are real even
 * when the phone library does not know their range.
 */
export function isUnsendableContactRow(row: ContactRowLike): boolean {
  if (!row) return false;
  if (isLegacyLidRow(row)) return true;
  if (row.added_manually === true) return false;
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  if (created >= Date.parse(LID_INGEST_FIX_AT)) return false;
  return !isPlausibleE164Digits(row.contact_number);
}

export type SendHistoryRow = {
  recipient_number: string | null;
  status?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  sent_at?: string | null;
};

/**
 * Numbers whose LAST outcome was WhatsApp answering "exists": false. Picking
 * them again would fail the same way (prod: 3466…2716 picked 4 times in 17
 * days). A later successful send clears it: the number works now.
 */
export function notOnWhatsAppNumbers(rows: SendHistoryRow[] | null | undefined): Set<string> {
  const lastFail = new Map<string, number>();
  const lastSent = new Map<string, number>();
  for (const r of rows || []) {
    const num = r?.recipient_number;
    if (!num) continue;
    if (r.status === 'sent') {
      const t = Date.parse(r.sent_at || r.created_at || '') || 0;
      lastSent.set(num, Math.max(lastSent.get(num) ?? 0, t));
    } else if (isNotOnWhatsAppError(r.error_message)) {
      const t = Date.parse(r.created_at || '') || 0;
      lastFail.set(num, Math.max(lastFail.get(num) ?? 0, t));
    }
  }
  const out = new Set<string>();
  lastFail.forEach((failedAt, num) => {
    if ((lastSent.get(num) ?? -1) < failedAt) out.add(num);
  });
  return out;
}
