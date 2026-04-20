import {
  extractInlineRecipient,
  extractInlineMessage,
  parseAIDatetime,
  romeToUtc,
  getRomeOffsetMs,
  escapeIlike,
} from '../app/lib/webhook-utils';

describe('extractInlineRecipient', () => {
  test('extracts name after "invia a" before time keyword', () => {
    expect(extractInlineRecipient('Invia a Marco domani alle 15: Ciao!')).toBe('Marco');
  });

  test('extracts name after "manda a"', () => {
    expect(extractInlineRecipient('Manda a Luca fra 2 ore: ricordati')).toBe('Luca');
  });

  test('extracts name after "scrivi a"', () => {
    expect(extractInlineRecipient('Scrivi a Maria domani alle 9: buongiorno')).toBe('Maria');
  });

  test('extracts multi-word name', () => {
    expect(extractInlineRecipient('Invia a Marco Rossi domani alle 15: Ciao!')).toBe('Marco Rossi');
  });

  test('extracts name with accented characters', () => {
    expect(extractInlineRecipient('Manda a José domani alle 10: test')).toBe('José');
  });

  test('extracts name after "dici a"', () => {
    expect(extractInlineRecipient('Dici a Papà domani alle 8: buongiorno')).toBe('Papà');
  });

  test('extracts name after "ricordami" with "a"', () => {
    expect(extractInlineRecipient('Ricordami a Mamma domani alle 9: chiamare dottore')).toBe('Mamma');
  });

  test('returns null for text without scheduling keywords', () => {
    expect(extractInlineRecipient('Ciao come stai?')).toBeNull();
  });

  test('returns null when no time indicator follows the name', () => {
    expect(extractInlineRecipient('Invia a Marco il documento')).toBeNull();
  });

  test('handles "ad" before vowel name', () => {
    expect(extractInlineRecipient('Scrivi ad Andrea domani alle 15: test')).toBe('Andrea');
  });
});

describe('extractInlineMessage', () => {
  test('extracts text after ": "', () => {
    expect(extractInlineMessage('Invia a Marco domani alle 15: Ciao come stai?')).toBe('Ciao come stai?');
  });

  test('returns null when no ": " separator', () => {
    expect(extractInlineMessage('Invia a Marco domani alle 15 Ciao')).toBeNull();
  });

  test('returns null when ": " is at end of string', () => {
    expect(extractInlineMessage('test: ')).toBeNull();
  });

  test('extracts message with colons inside', () => {
    expect(extractInlineMessage('Invia a Marco alle 15: Orario: 10:30')).toBe('Orario: 10:30');
  });

  test('trims whitespace from extracted message', () => {
    expect(extractInlineMessage('test:  hello world  ')).toBe('hello world');
  });
});

describe('parseAIDatetime — timezone handling (P4 fix)', () => {
  test('ISO with Z offset: uses Date directly (already UTC)', () => {
    const result = parseAIDatetime('2026-03-14T15:00:00Z');
    expect(result.toISOString()).toBe('2026-03-14T15:00:00.000Z');
  });

  test('ISO with +01:00 offset: uses Date directly (already has offset)', () => {
    const result = parseAIDatetime('2026-03-14T15:00:00+01:00');
    // +01:00 means 14:00 UTC
    expect(result.toISOString()).toBe('2026-03-14T14:00:00.000Z');
  });

  test('ISO with +02:00 offset (summer): uses Date directly', () => {
    const result = parseAIDatetime('2026-07-14T15:00:00+02:00');
    // +02:00 means 13:00 UTC
    expect(result.toISOString()).toBe('2026-07-14T13:00:00.000Z');
  });

  test('ISO WITHOUT offset: applies romeToUtc conversion', () => {
    // This should apply the Rome offset subtraction
    const result = parseAIDatetime('2026-03-14T15:00:00');
    const manualResult = romeToUtc(new Date('2026-03-14T15:00:00'));
    expect(result.getTime()).toBe(manualResult.getTime());
  });

  test('ISO without offset gives different result than with offset', () => {
    // Key test: these should NOT produce the same result
    // "15:00 Rome local" ≠ "15:00 UTC"
    const withoutOffset = parseAIDatetime('2026-03-14T15:00:00');
    const withZ = parseAIDatetime('2026-03-14T15:00:00Z');
    // Rome is UTC+1 in winter, so they should differ by ~1 hour
    const diffMs = Math.abs(withZ.getTime() - withoutOffset.getTime());
    expect(diffMs).toBeGreaterThan(0);
  });

  test('throws on invalid date string', () => {
    expect(() => parseAIDatetime('not-a-date')).toThrow('Invalid date');
  });
});

describe('escapeIlike — ILIKE wildcard injection prevention', () => {
  test('escapes % wildcard', () => {
    expect(escapeIlike('%admin%')).toBe('\\%admin\\%');
  });

  test('escapes _ wildcard', () => {
    expect(escapeIlike('M_rco')).toBe('M\\_rco');
  });

  test('escapes both % and _', () => {
    expect(escapeIlike('%test_name%')).toBe('\\%test\\_name\\%');
  });

  test('leaves normal names unchanged', () => {
    expect(escapeIlike('Marco Rossi')).toBe('Marco Rossi');
  });

  test('leaves accented characters unchanged', () => {
    expect(escapeIlike('José María')).toBe('José María');
  });

  test('handles empty string', () => {
    expect(escapeIlike('')).toBe('');
  });
});

import { extractInlinePhoneAndName } from '../app/lib/webhook-utils';

describe('extractInlinePhoneAndName', () => {
  test('extracts phone and name from "Invia a Mario Cementi 3331234567 alle 17"', () => {
    const r = extractInlinePhoneAndName('Invia a Mario Cementi 3331234567 alle 17: msg');
    expect(r.phone).toBe('393331234567');
    expect(r.name).toBe('Mario Cementi');
    expect(r.textWithoutPhone).not.toContain('3331234567');
  });

  test('extracts spaced phone "333 1234567"', () => {
    const r = extractInlinePhoneAndName('Mario 333 1234567 ora ciao');
    expect(r.phone).toBe('393331234567');
    expect(r.name).toBe('Mario');
  });

  test('handles no name (just phone)', () => {
    const r = extractInlinePhoneAndName('scrivi a 393331234567 alle 17 ciao');
    expect(r.phone).toBe('393331234567');
    expect(r.name).toBeNull();
  });

  test('returns null phone when no number present', () => {
    const r = extractInlinePhoneAndName('Mario alle 17 ciao');
    expect(r.phone).toBeNull();
    expect(r.name).toBeNull();
  });

  test('handles international number "+44 7700 900123"', () => {
    const r = extractInlinePhoneAndName('John +44 7700 900123 alle 9');
    expect(r.phone).toBe('447700900123');
    expect(r.name).toBe('John');
  });

  test('does NOT match a date "12/03/2026" as phone', () => {
    const r = extractInlinePhoneAndName('Mario 12/03/2026 alle 9 ciao');
    expect(r.phone).toBeNull();
  });

  test('extracts up to 3 capitalized words as name', () => {
    const r = extractInlinePhoneAndName('Invia a Marco Antonio Rossi 3331234567 alle 9');
    expect(r.name).toBe('Marco Antonio Rossi');
  });

  test('does NOT match plain digits sequence < 7 chars as phone', () => {
    const r = extractInlinePhoneAndName('Mario 123456 alle 9');
    expect(r.phone).toBeNull();
  });

  test('strips stray leading digit: "Rebecca 1 393275654257" → 393275654257', () => {
    // Regression: real bug where user typed "1" before actual number.
    // Parser must prefer the Italian mobile interpretation over the 13-digit blob.
    const r = extractInlinePhoneAndName('Invia a REBECCA 1 393275654257 oggi alle 16:33: ciao');
    expect(r.phone).toBe('393275654257');
    expect(r.name).toBe('REBECCA');
  });

  test('preserves valid UK prefix without +: "John 44 7700 900123" → 447700900123', () => {
    // Must NOT strip "44 " because it's a valid UK country code and the tail
    // is not Italian — stripping would corrupt a legitimate international number.
    const r = extractInlinePhoneAndName('John 44 7700 900123 alle 9');
    expect(r.phone).toBe('447700900123');
  });
});
