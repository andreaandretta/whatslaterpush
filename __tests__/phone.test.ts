import { normalizeItalianPhone, validatePhone, parsePhoneInput, phoneInputErrorMessage, isPlausibleE164Digits, flagEmoji, countryNameIt } from '../app/lib/phone';

describe('normalizeItalianPhone', () => {
  test('returns empty/falsy input as-is', () => {
    expect(normalizeItalianPhone('')).toBe('');
    expect(normalizeItalianPhone(null as any)).toBe(null);
    expect(normalizeItalianPhone(undefined as any)).toBe(undefined);
  });

  test('strips +39 prefix and keeps digits', () => {
    expect(normalizeItalianPhone('+393401234567')).toBe('393401234567');
  });

  test('strips 0039 prefix', () => {
    expect(normalizeItalianPhone('00393401234567')).toBe('393401234567');
  });

  test('landline: keeps the leading 0 under the 39 prefix (E.164 italiano)', () => {
    expect(normalizeItalianPhone('0612345678')).toBe('390612345678');
  });

  test('adds 39 prefix to 10-digit mobile starting with 3', () => {
    expect(normalizeItalianPhone('3401234567')).toBe('393401234567');
  });

  test('passes through already-normalized number (39...)', () => {
    expect(normalizeItalianPhone('393401234567')).toBe('393401234567');
  });

  test('strips spaces, dashes, parentheses', () => {
    expect(normalizeItalianPhone('340 123 4567')).toBe('393401234567');
    expect(normalizeItalianPhone('340-123-4567')).toBe('393401234567');
    expect(normalizeItalianPhone('(340) 1234567')).toBe('393401234567');
  });

  test('handles international non-Italian number (passthrough)', () => {
    // A US number won't match any Italian pattern, returned as clean digits
    expect(normalizeItalianPhone('+14155551234')).toBe('14155551234');
  });

  test('handles short number (no Italian prefix match)', () => {
    expect(normalizeItalianPhone('12345')).toBe('12345');
  });
});

describe('validatePhone', () => {
  test('returns normalized phone for valid 10-digit Italian mobile', () => {
    expect(validatePhone('3401234567')).toBe('393401234567');
  });

  test('returns normalized phone for valid +39 format', () => {
    expect(validatePhone('+393401234567')).toBe('393401234567');
  });

  test('returns null for too-short number (< 10 digits)', () => {
    expect(validatePhone('12345')).toBeNull();
    expect(validatePhone('123456789')).toBeNull();
  });

  test('returns null for too-long number (> 15 digits)', () => {
    expect(validatePhone('1234567890123456')).toBeNull();
  });

  test('strips non-digit characters before validating', () => {
    expect(validatePhone('+39 340 123 4567')).toBe('393401234567');
  });

  test('returns null for letters-only input', () => {
    expect(validatePhone('abcdefghij')).toBeNull();
  });

  test('handles mixed letters and digits', () => {
    // "abc3401234567" → clean = "3401234567" (10 digits) → valid
    expect(validatePhone('abc3401234567')).toBe('393401234567');
  });
});

// Audit 25 set 2026: numeri sbagliati accettati in silenzio (prod: 3466…2716
// ×4 e 1393…4257 ×2, tutti falliti exists:false). Casi dal vero.
describe('validatePhone — numeri che il vecchio controllo sulla lunghezza lasciava passare', () => {
  test('"00" è il prefisso internazionale, non un fisso italiano', () => {
    expect(validatePhone('0041 79 123 45 67')).toBe('41791234567');
    expect(validatePhone('0049 1512 3456789')).toBe('4915123456789');
    expect(validatePhone('0044 7911 123456')).toBe('447911123456');
    expect(validatePhone('0039 347 123 4567')).toBe('393471234567');
  });

  test('un prefisso spurio davanti (1393…) non è un numero', () => {
    expect(validatePhone('1393471234567')).toBeNull();
  });

  test('cifre di date/ore non diventano destinatari', () => {
    expect(validatePhone('1009202618')).toBeNull();
  });

  test("San Marino scritto all'italiana (0549) è +378", () => {
    expect(validatePhone('0549 991234')).toBe('3780549991234');
  });

  test('le cifre già E.164 (da JID o dal DB) restano quelle', () => {
    expect(validatePhone('393401234567')).toBe('393401234567');
    expect(validatePhone('14155551234')).toBe('14155551234');
    expect(validatePhone('2348031234567')).toBe('2348031234567');
    // Messico: WhatsApp usa ancora 521 + 10 cifre.
    expect(validatePhone('5215512345678')).toBe('5215512345678');
    // Brasile: cellulari registrati prima della nona cifra.
    expect(validatePhone('551187654321')).toBe('551187654321');
  });

  test('un numero di 10 cifre che inizia per 3 resta italiano (non Budapest +36 1)', () => {
    expect(validatePhone('3612345678')).toBe('393612345678');
  });
});

describe('normalizeItalianPhone — "00" e numeri già salvati', () => {
  test('0041… è Svizzera, non 390041…', () => {
    expect(normalizeItalianPhone('0041791234567')).toBe('41791234567');
    expect(normalizeItalianPhone('0049 1512 3456789')).toBe('4915123456789');
  });

  test('un numero salvato non viene mai riscritto', () => {
    expect(normalizeItalianPhone('34712345678')).toBe('34712345678');
    expect(normalizeItalianPhone('144392555855948')).toBe('144392555855948');
    expect(normalizeItalianPhone('390041791234567')).toBe('390041791234567');
  });
});

describe('parsePhoneInput — il numero scritto a mano in "Nuovo contatto"', () => {
  test('cellulare italiano con una cifra in più: rifiutato, non letto come Spagna', () => {
    expect(parsePhoneInput('347 12345 678')).toEqual({ ok: false, error: 'extra_digit' });
    expect(parsePhoneInput('33312345678').ok).toBe(false); // non Francia
  });

  test('senza + o 00 un numero estero non passa (va scritto col prefisso)', () => {
    expect(parsePhoneInput('447911123456')).toEqual({ ok: false, error: 'invalid' });
    expect(parsePhoneInput('41791234567').ok).toBe(false);
  });

  test('italiano: nessuna conferma richiesta', () => {
    expect(parsePhoneInput('347 123 4567')).toMatchObject({ ok: true, digits: '393471234567', italian: true, country: 'IT' });
    expect(parsePhoneInput('+39 347 123 4567')).toMatchObject({ ok: true, digits: '393471234567', italian: true });
    expect(parsePhoneInput('081 555 1234')).toMatchObject({ ok: true, digits: '390815551234', italian: true });
  });

  test('estero col prefisso: letto e formattato per la conferma', () => {
    expect(parsePhoneInput('+34 712 345 678')).toMatchObject({ ok: true, digits: '34712345678', country: 'ES', italian: false, international: '+34 712 34 56 78' });
    expect(parsePhoneInput('0041 79 123 45 67')).toMatchObject({ ok: true, digits: '41791234567', country: 'CH', italian: false });
    expect(parsePhoneInput('0549 991234')).toMatchObject({ ok: true, digits: '3780549991234', country: 'SM', italian: false });
  });

  test('vuoto, troppo corto, a pagamento', () => {
    expect(parsePhoneInput('')).toEqual({ ok: false, error: 'empty' });
    expect(parsePhoneInput('12345')).toEqual({ ok: false, error: 'invalid' });
    expect(parsePhoneInput('899 123 456')).toEqual({ ok: false, error: 'not_a_chat_number' });
  });

  test('ogni errore ha un testo in italiano', () => {
    for (const e of ['empty', 'invalid', 'extra_digit', 'not_a_chat_number'] as const) {
      expect(phoneInputErrorMessage(e).length).toBeGreaterThan(5);
    }
  });

  test('bandiera e nome del paese in italiano', () => {
    expect(flagEmoji('ES')).toBe('\u{1F1EA}\u{1F1F8}');
    expect(countryNameIt('ES')).toBe('Spagna');
    expect(flagEmoji(undefined)).toBe('');
  });
});

describe('isPlausibleE164Digits — righe della rubrica che non possono essere numeri', () => {
  test('LID di 13+ cifre (prefissi impossibili a quella lunghezza)', () => {
    expect(isPlausibleE164Digits('2812345678901')).toBe(false);
    expect(isPlausibleE164Digits('1542123452503')).toBe(false);
    expect(isPlausibleE164Digits('3213123451255')).toBe(false);
    expect(isPlausibleE164Digits('9165123459266')).toBe(false);
    expect(isPlausibleE164Digits('144392555855948')).toBe(false);
  });

  test('numeri veri, anche nelle forme che usa WhatsApp', () => {
    expect(isPlausibleE164Digits('393401234567')).toBe(true);
    expect(isPlausibleE164Digits('2348031234567')).toBe(true);
    expect(isPlausibleE164Digits('8613800138000')).toBe(true);
    expect(isPlausibleE164Digits('5215512345678')).toBe(true);
    expect(isPlausibleE164Digits('551187654321')).toBe(true);
  });
});
