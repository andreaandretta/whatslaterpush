/**
 * The single place that turns a WhatsApp JID into phone digits.
 *
 * Since Baileys 7 a contact's `id` is "either in lid or jid format" and
 * Evolution 2.3.7 forwards it verbatim as `remoteJid`: CONTACTS_UPSERT/UPDATE
 * deliver `<14-15 digit Linked ID>@lid` rows. A LID is an opaque identifier,
 * NOT a phone number: sending to `<lid>@s.whatsapp.net` fails with
 * `exists: false` ("Numero non su WhatsApp"). Prod 2026-09-25: 1.318 of
 * ~4.000 whatsapp_contacts rows were LIDs stored as numbers, and three real
 * messages failed because the picker offered them under the person's name.
 *
 * Only `@s.whatsapp.net` / `@c.us` address a person by phone number.
 */

const PHONE_JID = /^(\d{8,15})(?::\d+)?@(s\.whatsapp\.net|c\.us)$/;

/** Digits of a phone JID (device suffix stripped), or null for LID, group, broadcast, newsletter, junk. */
export function phoneDigitsFromJid(jid: unknown): string | null {
  if (typeof jid !== 'string' || !jid) return null;
  const m = PHONE_JID.exec(jid.trim());
  return m ? m[1] : null;
}

/**
 * The phone JID of a contact / chat / message envelope, whatever shape
 * Evolution or Baileys used. A contact addressed by LID resolves through
 * Baileys' `phoneNumber` (or Evolution's `remoteJidAlt` / `senderPn`) when
 * present; otherwise null — never the LID.
 */
export function phoneJidFromContact(c: unknown): string | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, any>;
  const candidates = [o.remoteJid, o.id, o.key?.remoteJid, o.phoneNumber, o.remoteJidAlt, o.key?.remoteJidAlt, o.senderPn, o.key?.senderPn, o.jid];
  for (const cand of candidates) {
    if (phoneDigitsFromJid(cand)) return (cand as string).trim();
  }
  return null;
}

/**
 * A number already stored as digits that is almost certainly a LID: 14-15
 * digits. Real E.164 numbers of that length are vanishingly rare (Italian
 * mobiles are 12 digits, landlines 11-12; the longest common foreign numbers
 * are 13) and in prod not one 14-15 digit recipient ever received a message.
 * Numbers the user typed by hand are trusted anyway (callers pass `manual`).
 */
export function looksLikeLidDigits(digits: unknown, manual = false): boolean {
  if (manual) return false;
  return typeof digits === 'string' && /^\d{14,15}$/.test(digits);
}

/**
 * From this instant the webhook and the photo backfill store phone JIDs only
 * (see phoneJidFromContact), so a 14-15 digit row created later is a real long
 * number. Only rows created before it can be a LID stored by mistake.
 */
export const LID_INGEST_FIX_AT = '2026-09-26T00:00:00Z';

/**
 * whatsapp_contacts row that is a LID stored as a number: 14-15 digits, not
 * typed by the user, created before LID_INGEST_FIX_AT (a missing date counts
 * as old). Nothing is deleted: callers only hide or refuse these rows.
 */
export function isLegacyLidRow(row: { contact_number?: unknown; added_manually?: boolean | null; created_at?: string | null } | null | undefined): boolean {
  if (!row || !looksLikeLidDigits(row.contact_number, row.added_manually === true)) return false;
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  return !(created >= Date.parse(LID_INGEST_FIX_AT));
}
