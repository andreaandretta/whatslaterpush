import { containsAmbiguousTimeKeyword, hasExplicitHHMM } from '../app/lib/quick-capture-utils';

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
