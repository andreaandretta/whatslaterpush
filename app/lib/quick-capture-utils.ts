/**
 * Restituisce true se il testo contiene una keyword di tempo vaga.
 * Le keyword "tra N ore", "alle HH" sono considerate esplicite (non ambigue).
 */
export function containsAmbiguousTimeKeyword(text: string): boolean {
  const t = text.toLowerCase();
  const patterns = [
    /\btra un po(?:'|\s|$)/,
    /\bpi[uù]\s+tardi\b/,
    /\bdopo\s+pranzo\b/,
    /\bstasera\s+tardi\b/,
    /\boggi\s+tardi\b/,
    /\bprima\s+o\s+poi\b/,
    /\bpresto\b/,
    /\bdopo\b(?!\s+\d)/,
  ];
  return patterns.some(p => p.test(t));
}

/**
 * Restituisce true se il testo contiene un orario esplicito tipo "alle 17", "alle 9:30",
 * oppure un'espressione relativa esplicita tipo "tra 2 ore".
 */
export function hasExplicitHHMM(text: string): boolean {
  const t = text.toLowerCase();
  if (/\balle\s+\d{1,2}(?::\d{2})?\b/.test(t)) return true;
  if (/\btra\s+\d+\s+(?:minut|or[ae]|sec)\w*\b/.test(t)) return true;
  return false;
}
