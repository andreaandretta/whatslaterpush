/**
 * Unit tests for app/lib/jid.ts — the single place that turns a WhatsApp JID
 * into phone digits.
 *
 * Background (prod 2026-09-06): since Baileys 7 a contact's `id` is "either in
 * lid or jid format". Evolution 2.3.7 forwards it verbatim as `remoteJid`, so
 * CONTACTS_UPSERT/UPDATE deliver `<14-15 digit Linked ID>@lid` rows. Only the
 * `@s.whatsapp.net` / `@c.us` forms address a person by phone number; every
 * other suffix must yield null, never a "phone number".
 */
import { phoneDigitsFromJid, phoneJidFromContact, isLegacyLidRow, LID_INGEST_FIX_AT, normalizeGroupJid, isGroupJid, recipientDisplayName, isPhoneLikeName, isOwnNumberName, realPersonName, formatPhoneForDisplay } from '../app/lib/jid';

describe('phoneDigitsFromJid', () => {
  test('returns the digits of a 12-digit @s.whatsapp.net JID', () => {
    expect(phoneDigitsFromJid('393401234567@s.whatsapp.net')).toBe('393401234567');
  });

  test('strips the :N device suffix before the @', () => {
    expect(phoneDigitsFromJid('393401234567:5@s.whatsapp.net')).toBe('393401234567');
  });

  test('accepts the legacy @c.us phone form', () => {
    expect(phoneDigitsFromJid('393401234567@c.us')).toBe('393401234567');
  });

  test('rejects a 14-digit @lid Linked ID', () => {
    expect(phoneDigitsFromJid('12345678901234@lid')).toBeNull();
  });

  test('rejects a 15-digit @lid Linked ID', () => {
    expect(phoneDigitsFromJid('123456789012345@lid')).toBeNull();
  });

  test('rejects group JIDs', () => {
    expect(phoneDigitsFromJid('120363012345678901@g.us')).toBeNull();
  });

  test('rejects broadcast JIDs', () => {
    expect(phoneDigitsFromJid('status@broadcast')).toBeNull();
  });

  test('rejects newsletter JIDs', () => {
    expect(phoneDigitsFromJid('120363012345678901@newsletter')).toBeNull();
  });

  test('rejects a phone JID whose local part is not all digits', () => {
    expect(phoneDigitsFromJid('invalid@s.whatsapp.net')).toBeNull();
  });

  test('rejects a bare number without a JID suffix', () => {
    expect(phoneDigitsFromJid('393401234567')).toBeNull();
  });

  test('rejects non-string input', () => {
    expect(phoneDigitsFromJid(undefined)).toBeNull();
    expect(phoneDigitsFromJid(null)).toBeNull();
    expect(phoneDigitsFromJid(42)).toBeNull();
    expect(phoneDigitsFromJid({})).toBeNull();
    expect(phoneDigitsFromJid('')).toBeNull();
  });
});

describe('phoneJidFromContact', () => {
  test('uses remoteJid when it is a phone JID', () => {
    expect(phoneJidFromContact({ remoteJid: '393401234567@s.whatsapp.net', id: 'uuid-1' }))
      .toBe('393401234567@s.whatsapp.net');
  });

  test('falls back to id when remoteJid is null (Evolution v2 Baileys-synced rows)', () => {
    expect(phoneJidFromContact({ remoteJid: null, id: '393401234567@s.whatsapp.net' }))
      .toBe('393401234567@s.whatsapp.net');
  });

  test('falls back to key.remoteJid (message envelopes)', () => {
    expect(phoneJidFromContact({ key: { remoteJid: '393401234567@s.whatsapp.net' } }))
      .toBe('393401234567@s.whatsapp.net');
  });

  test('resolves a Baileys 7 contact addressed by LID through its phoneNumber field', () => {
    // Types/Contact.ts: id = LID form, phoneNumber = "@s.whatsapp.net" form.
    expect(phoneJidFromContact({ id: '12345678901234@lid', phoneNumber: '393401234567@s.whatsapp.net' }))
      .toBe('393401234567@s.whatsapp.net');
  });

  test('returns null for an Evolution contacts.update row that only carries a @lid remoteJid', () => {
    expect(phoneJidFromContact({
      remoteJid: '123456789012345@lid',
      pushName: null,
      profilePicUrl: 'https://pps.whatsapp.net/x.jpg',
      instanceId: 'inst-1',
    })).toBeNull();
  });

  test('returns null when id is a Prisma UUID rather than a JID', () => {
    expect(phoneJidFromContact({ id: '2f1c6a2e-1b0d-4c1e-9c3a-0a1b2c3d4e5f' })).toBeNull();
  });

  test('returns null for non-object input', () => {
    expect(phoneJidFromContact(null)).toBeNull();
    expect(phoneJidFromContact(undefined)).toBeNull();
    expect(phoneJidFromContact('393401234567@s.whatsapp.net')).toBeNull();
  });
});

describe('isLegacyLidRow', () => {
  test('14-15 digits, synced, created before the fix → LID', () => {
    expect(isLegacyLidRow({ contact_number: '144392555855948', added_manually: false, created_at: '2026-09-25T14:01:23Z' })).toBe(true);
  });
  test('no created_at counts as old', () => {
    expect(isLegacyLidRow({ contact_number: '144392555855948', added_manually: false })).toBe(true);
  });
  test('created after the fix → real long number (the webhook no longer stores LIDs)', () => {
    expect(isLegacyLidRow({ contact_number: '62812345678901', added_manually: false, created_at: '2026-10-02T09:00:00Z' })).toBe(false);
    expect(isLegacyLidRow({ contact_number: '62812345678901', added_manually: false, created_at: LID_INGEST_FIX_AT })).toBe(false);
  });
  test('typed by hand, or a normal-length number → never a LID', () => {
    expect(isLegacyLidRow({ contact_number: '144392555855948', added_manually: true, created_at: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(isLegacyLidRow({ contact_number: '393401234567', added_manually: false, created_at: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(isLegacyLidRow(null)).toBe(false);
  });
});

describe('isGroupJid / normalizeGroupJid', () => {
  test('current group format (15-22 digits) → group', () => {
    expect(isGroupJid('120363012345678901@g.us')).toBe(true);
    expect(normalizeGroupJid('120363012345678901@g.us')).toBe('120363012345678901@g.us');
  });

  test('legacy <digits>-<timestamp> format → group', () => {
    expect(isGroupJid('393331234567-1600000000@g.us')).toBe(true);
  });

  test('spaces around and upper case are normalised', () => {
    expect(normalizeGroupJid('  120363012345678901@G.US ')).toBe('120363012345678901@g.us');
    expect(isGroupJid(' 120363012345678901@g.us\n')).toBe(true);
  });

  test.each([
    ['12345@g.us'],
    ['status@broadcast'],
    ['120363012345678901@newsletter'],
    ['12345678901234@lid'],
    ['393331234567@s.whatsapp.net'],
    ['393331234567'],
    ['120363012345678901@g.us.evil'],
    [''],
  ])('%s → not a group', (raw) => {
    expect(isGroupJid(raw)).toBe(false);
    expect(normalizeGroupJid(raw)).toBeNull();
  });

  test('non-strings → not a group', () => {
    expect(isGroupJid(null)).toBe(false);
    expect(isGroupJid(undefined)).toBe(false);
    expect(isGroupJid(120363012345678901)).toBe(false);
  });
});

describe('recipientDisplayName', () => {
  test('group with a name → the name', () => {
    expect(recipientDisplayName({ recipient_name: 'Under 12 – Genitori', recipient_number: '120363012345678901@g.us' })).toBe('Under 12 – Genitori');
  });

  test('group without a name → "Gruppo senza nome", never the digits', () => {
    for (const recipient_name of [null, undefined, '', '   ']) {
      const out = recipientDisplayName({ recipient_name, recipient_number: '393331234567-1600000000@g.us' });
      expect(out).toBe('Gruppo senza nome');
      expect(out).not.toMatch(/\d/);
    }
  });

  test('people: name, else readable number, else +?', () => {
    expect(recipientDisplayName({ recipient_name: 'Mario', recipient_number: '393331234567' })).toBe('Mario');
    expect(recipientDisplayName({ recipient_name: null, recipient_number: '393331234567' })).toBe('+39 333 123 4567');
    expect(recipientDisplayName({ recipient_name: null, recipient_number: '447700900123' })).toBe('+447700900123');
    expect(recipientDisplayName({ recipient_name: null, recipient_number: null })).toBe('+?');
  });

  // Rapporto 360, T11: righe già salvate col numero stesso come "nome".
  test('the number itself as name counts as no name', () => {
    expect(recipientDisplayName({ recipient_name: '393331234567', recipient_number: '393331234567' })).toBe('+39 333 123 4567');
    expect(recipientDisplayName({ recipient_name: '+39 333 123-4567', recipient_number: '393331234567' })).toBe('+39 333 123 4567');
    expect(recipientDisplayName({ recipient_name: 'Squadra 2012', recipient_number: '393331234567' })).toBe('Squadra 2012');
  });

  // Revisione: un nome di sole cifre scelto apposta resta (come il server).
  test('a digits-only name that is NOT the number is kept', () => {
    expect(recipientDisplayName({ recipient_name: '118', recipient_number: '393401111111' })).toBe('118');
    expect(recipientDisplayName({ recipient_name: '10', recipient_number: '393401111111' })).toBe('10');
  });
});

describe('isPhoneLikeName / realPersonName / formatPhoneForDisplay', () => {
  test('only phone characters with at least one digit', () => {
    expect(isPhoneLikeName('393331234567')).toBe(true);
    expect(isPhoneLikeName('+39 (333) 123-45.67')).toBe(true);
    expect(isPhoneLikeName('Mario')).toBe(false);
    expect(isPhoneLikeName('Mario 2')).toBe(false);
    expect(isPhoneLikeName('+ -')).toBe(false);
    expect(isPhoneLikeName('')).toBe(false);
    expect(isPhoneLikeName(null)).toBe(false);
  });

  // Stessa regola di isNoRealName (app/api/contacts/route.ts): almeno 6 cifre,
  // confronto sulla coda del numero.
  test('isOwnNumberName: only the contact\'s own number, written in any way', () => {
    expect(isOwnNumberName('393331234567', '393331234567')).toBe(true);
    expect(isOwnNumberName('+39 333 123 4567', '393331234567')).toBe(true);
    expect(isOwnNumberName('333 1234567', '393331234567')).toBe(true);
    expect(isOwnNumberName('0039 333 1234567', '393331234567')).toBe(true);
    expect(isOwnNumberName('081 555 1234', '390815551234')).toBe(true);
    expect(isOwnNumberName('118', '393401111111')).toBe(false);
    expect(isOwnNumberName('1522', '393401111111')).toBe(false);
    expect(isOwnNumberName('393339999999', '393331234567')).toBe(false);
    expect(isOwnNumberName('Mario', '393331234567')).toBe(false);
    expect(isOwnNumberName('393331234567', '')).toBe(false);
  });

  test('realPersonName trims and drops the number used as name', () => {
    expect(realPersonName('  Anna  ', '393331234567')).toBe('Anna');
    expect(realPersonName('393331234567', '393331234567')).toBeUndefined();
    expect(realPersonName('118', '393401111111')).toBe('118');
    expect(realPersonName('   ', '393331234567')).toBeUndefined();
    expect(realPersonName(null, '393331234567')).toBeUndefined();
  });

  test('formatPhoneForDisplay: Italian mobiles and landlines grouped, the rest +digits', () => {
    expect(formatPhoneForDisplay('393331234567')).toBe('+39 333 123 4567');
    expect(formatPhoneForDisplay('390815551234')).toBe('+39 081 555 1234');
    expect(formatPhoneForDisplay('39 02 1234567')).toBe('+39 02 123 4567');
    expect(formatPhoneForDisplay('39333123456')).toBe('+39 333 123 456');
    expect(formatPhoneForDisplay('447700900123')).toBe('+447700900123');
    expect(formatPhoneForDisplay('')).toBe('+?');
  });
});
