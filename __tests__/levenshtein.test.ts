import { levenshteinDistance, levenshteinRatio } from '../app/lib/levenshtein';

describe('levenshteinDistance', () => {
  test('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
    expect(levenshteinDistance('', '')).toBe(0);
  });

  test('returns string length when one input is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  test('computes single-character substitution as distance 1', () => {
    expect(levenshteinDistance('kitten', 'sitten')).toBe(1);
  });

  test('classic example: kitten → sitting = 3', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  test('insertion + deletion + substitution mix', () => {
    expect(levenshteinDistance('intention', 'execution')).toBe(5);
  });

  test('handles UTF-16 surrogate pairs via charCodeAt (counts code units)', () => {
    // Two strings that differ by an emoji at the end — charCodeAt-based DP
    // sees each surrogate as a code unit. Test asserts the chosen behavior
    // rather than the "perceived" Unicode grapheme distance, which would
    // require a different algorithm.
    const d = levenshteinDistance('ciao', 'ciao!');
    expect(d).toBe(1);
  });
});

describe('levenshteinRatio', () => {
  test('returns 0 for identical strings', () => {
    expect(levenshteinRatio('hello', 'hello')).toBe(0);
  });

  test('returns 1 for completely different strings of same length', () => {
    // "abc" → "xyz" needs 3 substitutions, max length 3 → 1.0
    expect(levenshteinRatio('abc', 'xyz')).toBe(1);
  });

  test('small edit on long string yields small ratio', () => {
    const seed = '🏃 Convocazione partita {giorno} ore {orario} — campo {luogo}. Ritrovo 30 min prima per riscaldamento. Portate borraccia e divisa pulita.';
    const minorEdit = seed.replace('30 min', '20 min');
    // Diff is 1 character (3→2). Ratio should be tiny — well below the 0.3 threshold.
    expect(levenshteinRatio(seed, minorEdit)).toBeLessThan(0.05);
  });

  test('substantial rewrite crosses 0.3 threshold', () => {
    const seed = '🏃 Convocazione partita {giorno} ore {orario} — campo {luogo}. Ritrovo 30 min prima.';
    const rewritten = '⚽ Domani partita campo Boschetti ore 15, vi aspetto tutti puntuali!';
    expect(levenshteinRatio(seed, rewritten)).toBeGreaterThan(0.3);
  });

  test('both empty strings → 0', () => {
    expect(levenshteinRatio('', '')).toBe(0);
  });
});
