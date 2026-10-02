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

// ── Gruppi ──
// Un gruppo si salva col JID intero in scheduled_messages.recipient_number: il
// tipo di destinatario si ricava dal suffisso. Formato attuale `120363…@g.us`
// (15-22 cifre) o vecchio `<telefono creatore>-<timestamp>@g.us`. Broadcast,
// newsletter, LID e JID malformati (es. `12345@g.us`) NON sono gruppi.
const GROUP_JID = /^(?:\d{15,22}|\d{8,15}-\d{9,11})@g\.us$/;

/** JID di gruppo canonico (trim + minuscolo), oppure null. */
export function normalizeGroupJid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return GROUP_JID.test(s) ? s : null;
}

export function isGroupJid(raw: unknown): boolean {
  return normalizeGroupJid(raw) !== null;
}

// ── Nomi delle persone ──
// Un "nome" che è il numero stesso del contatto ("393331234567", "+39 333
// 123 4567") vale come nessun nome. Un nome di sole cifre DIVERSO dal numero
// ("118", "1522", la maglia "10") è stato scelto apposta e resta: stessa
// regola del server (isNoRealName in app/api/contacts/route.ts).

/** true se il nome contiene solo caratteri da numero di telefono (almeno una cifra). */
export function isPhoneLikeName(name: unknown): boolean {
  return typeof name === 'string' && /^[\s\d+().-]*\d[\s\d+().-]*$/.test(name);
}

/** true se il "nome" è il numero del contatto scritto per intero (almeno 6 cifre). */
export function isOwnNumberName(name: unknown, number: unknown): boolean {
  if (!isPhoneLikeName(name)) return false;
  const d = (name as string).replace(/\D/g, '');
  const num = String(number ?? '').replace(/\D/g, '');
  if (d.length < 6 || !num) return false;
  return num.endsWith(d) || d.endsWith(num.slice(-9));
}

/** Il nome vero di una persona, oppure undefined se manca o è il suo numero. */
export function realPersonName(name: string | null | undefined, number: string | null | undefined): string | undefined {
  const n = (name || '').trim();
  return n && !isOwnNumberName(n, number) ? n : undefined;
}

/**
 * Numero leggibile, uguale in selettore, finestra e lista: "+39 333 123 4567"
 * per un cellulare italiano, "+39 081 555 1234" per un fisso, altrimenti "+cifre".
 */
export function formatPhoneForDisplay(digits: string | null | undefined): string {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d) return '+?';
  if (d.startsWith('39') && (d.length === 11 || d.length === 12)) {
    const local = d.slice(2);
    if (local.length === 10) return `+39 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
    if (local.startsWith('3')) return `+39 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
    return `+39 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
  }
  return `+${d}`;
}

/**
 * Nome da mostrare per una riga di scheduled_messages. Un gruppo senza nome
 * non mostra mai le cifre del JID: nel formato vecchio sono il telefono di chi
 * ha creato il gruppo. Una persona senza nome (o col suo numero come nome) si
 * mostra col numero leggibile: "+39 333 123 4567".
 */
export function recipientDisplayName(m: { recipient_name?: string | null; recipient_number?: string | null }): string {
  const name = m?.recipient_name;
  if (isGroupJid(m?.recipient_number)) return name && name.trim() ? name : 'Gruppo senza nome';
  return realPersonName(name, m?.recipient_number) || formatPhoneForDisplay(m?.recipient_number);
}
