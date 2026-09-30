// #2: initials from a contact name, or '' when there's no real name.
//
// We deliberately do NOT fall back to the phone digits — a digit "avatar" reads as
// "the photo is a number", especially for unsynced contacts that have neither a name
// nor a photo. ContactAvatar renders a neutral person glyph when this returns ''.
//
// Nomi di gruppo: si contano solo le parole con almeno una lettera o cifra, e il
// primo carattere si prende dopo la punteggiatura iniziale, per code point (mai
// mezza emoji): '🏀 Under 12' → 'U1', 'Under 12 – Genitori' → 'U1'.
// Costruttore e non letterale: col target di tsconfig (ES5) tsc rifiuta il flag `u` nei letterali.
const LETTER_OR_DIGIT = new RegExp('[\\p{L}\\p{N}]', 'u');

function firstLetterOrDigit(word: string): string {
  const chars = Array.from(word);
  const i = chars.findIndex((c) => LETTER_OR_DIGIT.test(c));
  return i === -1 ? '' : chars[i];
}

export function computeInitials(name: string | undefined): string {
  const n = (name || '').trim();
  if (!n) return '';
  const words = n.split(/\s+/).filter((w) => LETTER_OR_DIGIT.test(w));
  if (words.length === 0) return '';
  if (words.length >= 2) return (firstLetterOrDigit(words[0]) + firstLetterOrDigit(words[1])).toUpperCase();
  return firstLetterOrDigit(words[0]).toUpperCase();
}
