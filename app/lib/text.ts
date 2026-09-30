// Taglio di testo sicuro per l'utente: un `.slice()` nudo lavora in unità
// UTF-16 e può spezzare un'emoji o una lettera composta a metà (pattern #4 di
// CLAUDE.md), lasciando un carattere rotto nel nome o nell'anteprima.

function graphemesOf(s: string): string[] {
  const Segmenter = (Intl as any).Segmenter;
  if (typeof Segmenter === 'function') {
    return Array.from(new Segmenter('it', { granularity: 'grapheme' }).segment(s), (x: any) => x.segment as string);
  }
  // Ripiego senza Intl.Segmenter: almeno non spezza le coppie surrogate.
  return Array.from(s);
}

/** Taglia senza spezzare emoji o lettere composte. `max` in unità UTF-16, come il vecchio `.slice(0, max)`. */
export function truncateAtGrapheme(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  if (!(max > 0)) return '';
  let out = '';
  const parts = graphemesOf(s);
  for (let i = 0; i < parts.length; i++) {
    if (out.length + parts[i].length > max) break;
    out += parts[i];
  }
  return out;
}
