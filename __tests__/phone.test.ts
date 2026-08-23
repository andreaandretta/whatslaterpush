import { normalizeItalianPhone, validatePhone } from '../app/lib/phone';

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
