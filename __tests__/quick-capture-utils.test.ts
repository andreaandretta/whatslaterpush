import { formatDatePhrase, containsAmbiguousTimeKeyword, hasExplicitHHMM } from '../app/lib/quick-capture-utils';

describe('formatDatePhrase', () => {
  test('formats today HH:MM as "oggi alle HH:MM"', () => {
    const today = new Date();
    today.setHours(17, 0, 0, 0);
    expect(formatDatePhrase(today)).toBe('oggi alle 17:00');
  });

  test('formats tomorrow HH:MM as "domani alle HH:MM"', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    expect(formatDatePhrase(tomorrow)).toBe('domani alle 09:00');
  });

  test('formats date >= 2 days ahead as "il DD/MM alle HH:MM"', () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    future.setHours(14, 30, 0, 0);
    const result = formatDatePhrase(future);
    expect(result).toMatch(/^il \d{2}\/\d{2} alle 14:30$/);
  });

  test('zero-pads single-digit hours/minutes', () => {
    const today = new Date();
    today.setHours(9, 5, 0, 0);
    expect(formatDatePhrase(today)).toBe('oggi alle 09:05');
  });
});

describe('containsAmbiguousTimeKeyword', () => {
  test.each([
    'tra un po ti scrivo',
    'TRA UN PO',
    'più tardi',
    'piu tardi',
    'dopo pranzo facciamo',
    'stasera tardi',
    'oggi tardi',
    'prima o poi',
    'presto andiamo',
    'dopo facciamo',
  ])('returns true for "%s"', (input) => {
    expect(containsAmbiguousTimeKeyword(input)).toBe(true);
  });

  test.each([
    'domani alle 17',
    'alle 14:30',
    'oggi alle 9',
    'tra 2 ore',
  ])('returns false for "%s"', (input) => {
    expect(containsAmbiguousTimeKeyword(input)).toBe(false);
  });
});

describe('hasExplicitHHMM', () => {
  test('true for "alle 17"', () => {
    expect(hasExplicitHHMM('Mario alle 17: msg')).toBe(true);
  });

  test('true for "alle 9:30"', () => {
    expect(hasExplicitHHMM('Mario alle 9:30: msg')).toBe(true);
  });

  test('true for "alle 17:00"', () => {
    expect(hasExplicitHHMM('Mario alle 17:00: msg')).toBe(true);
  });

  test('false for "domani" senza ora', () => {
    expect(hasExplicitHHMM('Mario domani: msg')).toBe(false);
  });

  test('false for "stasera" senza ora', () => {
    expect(hasExplicitHHMM('Mario stasera: msg')).toBe(false);
  });

  test('true for "tra 2 ore" (relative explicit)', () => {
    expect(hasExplicitHHMM('Mario tra 2 ore: msg')).toBe(true);
  });

  test('false for "presto"', () => {
    expect(hasExplicitHHMM('Mario presto: msg')).toBe(false);
  });
});
