import { truncateAtGrapheme } from '../app/lib/text';

describe('truncateAtGrapheme', () => {
  test('short strings are returned as they are', () => {
    expect(truncateAtGrapheme('Genitori', 100)).toBe('Genitori');
    expect(truncateAtGrapheme('', 10)).toBe('');
  });

  test('plain text is cut like .slice', () => {
    expect(truncateAtGrapheme('abcdef', 3)).toBe('abc');
  });

  test('never splits an emoji (surrogate pair)', () => {
    // '🏀' = 2 unità UTF-16: con max 3 non ci sta un secondo pallone intero.
    const out = truncateAtGrapheme('a🏀🏀', 4);
    expect(out).toBe('a🏀');
    expect(out.length).toBeLessThanOrEqual(4);
  });

  test('never splits a ZWJ family', () => {
    const family = '👨‍👩‍👧‍👦'; // 11 unità UTF-16
    const out = truncateAtGrapheme('ok ' + family + ' fine', 8);
    expect(out).toBe('ok ');
    expect(truncateAtGrapheme('ok ' + family + ' fine', 14)).toBe('ok ' + family);
  });

  test('never splits a letter with a combining accent', () => {
    const e = 'é'; // é composta
    expect(truncateAtGrapheme('caff' + e, 5)).toBe('caff');
    expect(truncateAtGrapheme('caff' + e, 6)).toBe('caff' + e);
  });

  test('respects max (UTF-16 units) on long mixed input', () => {
    const s = '⚽️ Under 12 – Genitori 👨‍👩‍👧‍👦 '.repeat(20);
    for (const max of [1, 7, 33, 100]) {
      expect(truncateAtGrapheme(s, max).length).toBeLessThanOrEqual(max);
    }
  });

  test('max 0 or negative → empty string', () => {
    expect(truncateAtGrapheme('abc', 0)).toBe('');
    expect(truncateAtGrapheme('abc', -1)).toBe('');
  });
});
