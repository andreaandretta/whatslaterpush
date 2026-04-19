/**
 * Formatta una data in italiano per inserimento in frase naturale.
 * Esempi: "oggi alle 17:00", "domani alle 09:00", "il 24/04 alle 14:30"
 */
export function formatDatePhrase(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;

  if (diffDays === 0) return `oggi alle ${time}`;
  if (diffDays === 1) return `domani alle ${time}`;
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  return `il ${dd}/${mo} alle ${time}`;
}

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
