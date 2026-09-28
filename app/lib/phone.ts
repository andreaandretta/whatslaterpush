/**
 * Unified phone normalization for WhatsLater.
 *
 * Built on libphonenumber-js (metadata "max": the "min" set only checks
 * lengths, and would accept "34712345678" as a valid Italian number).
 *
 * Why (audit 25 set 2026): the old check was "10-15 digits". A mobile typed
 * with one digit doubled ("347 12345 678") was stored as is and read by
 * WhatsApp as +34 (Spain); "0041 79 …" became 390041… (the 00 was taken for an
 * Italian landline 0); a stray leading "1" made a 13-digit junk number. Now
 * every number must be valid for its country, and "00" means "+".
 *
 * Two readings of the same digits:
 *  - parsePhoneInput(): what a PERSON typed. Without "+" or "00" it is an
 *    Italian number, full stop (a foreign number must carry its prefix).
 *  - validatePhone() / normalizeItalianPhone(): digits we STORED or got from a
 *    WhatsApp JID (already E.164 without "+"), plus the legacy shapes
 *    ("3401234567", "0612345678") older clients still send.
 */
import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max';

// Tipi che non possono avere WhatsApp. VOICEMAIL è il caso vero: in Italia
// "3xx" + 8 cifre (11 cifre) è la segreteria, cioè un cellulare con una
// cifra in più. Numeri verdi e condivisi restano ammessi (li filtra il check
// di esistenza su WhatsApp, non noi).
const NOT_A_CHAT_NUMBER = new Set(['VOICEMAIL', 'PAGER', 'PREMIUM_RATE']);

function acceptable(p: PhoneNumber | undefined): p is PhoneNumber {
  if (!p || !p.isValid()) return false;
  const type = p.getType();
  return !(type && NOT_A_CHAT_NUMBER.has(type));
}

// San Marino dialled the Italian way ("0549 …") is +378 0549 …, not +39.
function sanMarinoOrSelf(p: PhoneNumber): PhoneNumber {
  if (p.countryCallingCode !== '39' || !p.nationalNumber.startsWith('0549')) return p;
  const sm = parsePhoneNumberFromString('+378' + p.nationalNumber);
  return acceptable(sm) ? sm : p;
}

function digitsOf(p: PhoneNumber): string {
  return p.number.replace(/\D/g, '');
}

// WhatsApp addresses some countries in a form libphonenumber calls invalid:
// Mexican mobiles keep the old "1" (521 + 10 digits). Only for CHECKING: the
// digits we store and send stay exactly the ones WhatsApp uses.
function forValidation(e164Digits: string): string {
  return /^521\d{10}$/.test(e164Digits) ? '52' + e164Digits.slice(3) : e164Digits;
}

/**
 * E.164 digits (no "+") that can be a real number. Valid for its country, or
 * at least of a possible length for it when shorter than 13 digits (WhatsApp
 * JIDs include shapes libphonenumber rejects, e.g. Brazilian mobiles without
 * the ninth digit). From 13 digits up it must be fully valid: that is where
 * the Linked IDs stored as numbers live ("2812345678901", "1542…").
 */
export function isPlausibleE164Digits(digits: unknown): boolean {
  if (typeof digits !== 'string' || !/^\d{6,15}$/.test(digits)) return false;
  const p = parsePhoneNumberFromString('+' + forValidation(digits));
  if (!p) return false;
  if (p.isValid()) return true;
  return digits.length < 13 && p.isPossible();
}

/**
 * Stored / JID / legacy digits → E.164 digits, or null. Order matters:
 *  1. "00…" is the international prefix ("0039…" included).
 *  2. "0…" is an Italian landline (E.164 never starts with 0).
 *  3. 10 digits starting with 3 is an Italian mobile without +39 (legacy
 *     rule: "3612345678" would otherwise be a valid Budapest number).
 *  4. otherwise the digits already carry their country code.
 *  5. last chance, up to 9 digits only: an Italian national number (e.g.
 *     9-digit old mobiles).
 * A reading that is fully valid wins; if none is, the digits as they are
 * (never an Italian guess) are kept when plausible (isPlausibleE164Digits).
 * The digits returned are the ones read, never rewritten by the library.
 */
function parseStoredDigits(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.replace(/\D/g, '');
  if (clean.length < 6 || clean.length > 17) return null;
  const tries: string[] = [];
  let asIs: string | null = null;
  if (raw.trim().startsWith('+')) asIs = clean;
  else if (clean.startsWith('00')) asIs = clean.slice(2);
  else if (clean.startsWith('0')) tries.push('39' + clean);
  else {
    if (clean.startsWith('3') && clean.length === 10) tries.push('39' + clean);
    asIs = clean;
  }
  if (asIs) tries.push(asIs);
  // Last chance only for digits too short to carry a country code (old 9-digit
  // mobiles, 8xx numbers). A 10+ digit JID/DB number the library does not
  // know ("4386669739") must stay as is: "39"+digits would be a DIFFERENT,
  // valid Italian number, maybe a stranger's (review fase 1).
  if (!raw.trim().startsWith('+') && !clean.startsWith('0') && clean.length <= 9) tries.push('39' + clean);
  for (const t of tries) {
    if (acceptable(parsePhoneNumberFromString('+' + forValidation(t)))) return t;
  }
  if (asIs && isPlausibleE164Digits(asIs)) {
    // Plausible but not valid: still refuse a number the library reads as a
    // voicemail/premium line.
    const p = parsePhoneNumberFromString('+' + forValidation(asIs));
    if (!(p && p.isValid())) return asIs;
  }
  return null;
}

/**
 * Kept for the cron and the calendar: always returns a string. A number
 * libphonenumber can read comes back as E.164 digits; anything else falls back
 * to the old shape rules (so a stored number is never mangled further).
 */
export function normalizeItalianPhone(raw: string): string {
  if (!raw) return raw;
  const parsed = parseStoredDigits(raw);
  if (parsed) return parsed;
  const clean = raw.replace(/\D/g, '');
  if (clean.startsWith('0039')) return clean.substring(2); // 00393401234567 → 393401234567
  // "00" è il prefisso internazionale: 0041… è Svizzera, non un fisso italiano.
  if (clean.startsWith('00')) return clean.substring(2);
  if (clean.startsWith('39') && clean.length >= 11) return clean;
  // Fissi italiani: lo 0 FA PARTE del numero anche in formato internazionale
  // (+39 081... → 39081...). Il vecchio drop dello 0 produceva JID inesistenti
  // (Evolution 400 exists:false — bug stanato dal primo destinatario fisso,
  // 23 ago). Nota: il ramo 0039 sopra lo 0 l'ha sempre tenuto.
  if (clean.startsWith('0')) return '39' + clean;
  if (clean.startsWith('3') && clean.length === 10) return '39' + clean;
  return clean;
}

/**
 * Stored/JID/legacy digits → E.164 digits, or null when they cannot be a real
 * number (see parseStoredDigits). Server side and self-chat use this; what a
 * person types goes through parsePhoneInput instead.
 */
export function validatePhone(raw: string): string | null {
  const parsed = parseStoredDigits(raw);
  if (!parsed) return null;
  const p = parsePhoneNumberFromString('+' + parsed);
  return p && p.isValid() ? digitsOf(sanMarinoOrSelf(p)) : parsed;
}

export type PhoneInputError = 'empty' | 'invalid' | 'extra_digit' | 'not_a_chat_number';

export type PhoneInputResult =
  | {
      ok: true;
      /** E.164 digits, no "+" (what the API and the DB store). */
      digits: string;
      /** ISO 3166 code ("IT", "ES", …); undefined when the prefix is shared and unclear. */
      country?: string;
      /** true for +39 (Vatican included): no confirmation needed. */
      italian: boolean;
      /** "+34 712 34 56 78" */
      international: string;
    }
  | { ok: false; error: PhoneInputError };

/**
 * What the user typed in "Nuovo contatto". Without "+" or "00" the number is
 * Italian: "34712345678" is NOT read as Spain, it is an Italian mobile with a
 * digit too many and gets refused. A foreign number is accepted only with its
 * prefix, and the caller shows how it was read before going on.
 */
export function parsePhoneInput(raw: string): PhoneInputResult {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const clean = text.replace(/\D/g, '');
  if (!clean) return { ok: false, error: 'empty' };
  let candidate: string;
  if (text.replace(/[\s().-]/g, '').startsWith('+')) candidate = '+' + clean;
  else if (clean.startsWith('00')) candidate = '+' + clean.slice(2);
  else candidate = clean;
  const p = candidate.startsWith('+')
    ? parsePhoneNumberFromString(candidate)
    : parsePhoneNumberFromString(candidate, 'IT');
  if (!p || !p.isValid()) return { ok: false, error: 'invalid' };
  const type = p.getType();
  if (type === 'VOICEMAIL' && p.countryCallingCode === '39') return { ok: false, error: 'extra_digit' };
  if (type && NOT_A_CHAT_NUMBER.has(type)) return { ok: false, error: 'not_a_chat_number' };
  const final = sanMarinoOrSelf(p);
  return {
    ok: true,
    digits: digitsOf(final),
    country: final.country,
    italian: final.countryCallingCode === '39',
    international: final.formatInternational(),
  };
}

export type PairingNumberResult =
  | {
      ok: true;
      /** E.164 digits, no "+" (what /api/auth/init receives). */
      digits: string;
      /** Italian number without +39 ("3471234567"), for the field; undefined when foreign. */
      national?: string;
      italian: boolean;
      country?: string;
      /** "+39 347 123 4567" — repeated on step 2 so the user checks it is HIS. */
      international: string;
    }
  | { ok: false; error: PhoneInputError };

/**
 * The user's OWN number in /connect (the field shows a fixed +39). Phones
 * autofill it, and people paste it, as "+39 347 123 4567" or "0039…": the old
 * field kept only the first 10 digits ("393 471 2345") and, one edit later,
 * asked WhatsApp for a pairing code for a stranger's number (hunt fase 1).
 * Reading order:
 *  1. with "+" / "00": the number as written (foreign ones too);
 *  2. otherwise Italian, like parsePhoneInput (landlines 06…, 9-11 digits);
 *  3. otherwise "39" + national number typed without "+" (autofill that drops
 *     the "+"): 12 digits or "390…" only, and only when that reads as a valid
 *     ITALIAN number.
 */
export function readPairingNumber(raw: string): PairingNumberResult {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const clean = text.replace(/\D/g, '');
  let r = parsePhoneInput(text);
  // Only 12 digits (39 + mobile) or "390…" (39 + landline, which always starts
  // with 0): an 11-digit "393…" is a 393 mobile with a digit too many, and
  // reading it as +39 would silently turn it into ANOTHER, shorter number.
  if (!r.ok && !/^\s*(\+|00)/.test(text) && clean.startsWith('39') && (clean.length === 12 || (clean[2] === '0' && clean.length <= 13))) {
    const withPrefix = parsePhoneInput('+' + clean);
    if (withPrefix.ok && withPrefix.italian) r = withPrefix;
  }
  if (!r.ok) return r;
  return {
    ok: true,
    digits: r.digits,
    national: r.italian && r.digits.startsWith('39') ? r.digits.slice(2) : undefined,
    italian: r.italian,
    country: r.country,
    international: r.international,
  };
}

/** Italian copy for parsePhoneInput errors (shown under the field). */
export function phoneInputErrorMessage(error: PhoneInputError): string {
  switch (error) {
    case 'empty':
      return 'Scrivi il numero.';
    case 'extra_digit':
      return 'Sembra un cellulare con una cifra in più: controlla il numero.';
    case 'not_a_chat_number':
      return 'Questo numero non può avere WhatsApp (segreteria o numero a pagamento).';
    default:
      return 'Numero non valido. Controlla le cifre; se è estero scrivilo col prefisso, es. +41 79 123 45 67.';
  }
}

/** "🇪🇸" from "ES"; empty when the country is unknown. */
export function flagEmoji(country?: string): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return '';
  return String.fromCodePoint(...Array.from(country).map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Country name in Italian ("Spagna"), or the ISO code when Intl lacks it. */
export function countryNameIt(country?: string): string {
  if (!country) return '';
  try {
    const dn = new (Intl as any).DisplayNames(['it'], { type: 'region' });
    return dn.of(country) || country;
  } catch {
    return country;
  }
}
