/**
 * #2: avatar initials fallback. No-name must NOT produce phone digits (which read as
 * "the photo is a number"); it returns '' and ContactAvatar renders a person glyph.
 */
import { computeInitials } from '../app/lib/contact-initials';

describe('computeInitials', () => {
  test('single name -> first letter, uppercased', () => {
    expect(computeInitials('mario')).toBe('M');
  });

  test('two words -> two initials, uppercased', () => {
    expect(computeInitials('Anna Rossi')).toBe('AR');
  });

  test('three+ words -> first two initials', () => {
    expect(computeInitials('Maria Anna Rossi')).toBe('MA');
  });

  test('collapses extra whitespace', () => {
    expect(computeInitials('  Luca   Verdi ')).toBe('LV');
  });

  test('undefined name -> "" (render shows a neutral person glyph)', () => {
    expect(computeInitials(undefined)).toBe('');
  });

  test('empty / whitespace-only name -> ""', () => {
    expect(computeInitials('')).toBe('');
    expect(computeInitials('   ')).toBe('');
  });

  test('never emits phone digits for a missing name (the #2 regression)', () => {
    // Old behavior returned number.slice(-3); the new contract has no number param
    // and can never produce a digit string.
    expect(computeInitials(undefined)).not.toMatch(/\d/);
    expect(computeInitials('')).not.toMatch(/\d/);
  });
});
