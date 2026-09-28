/**
 * Segnaposto dei template ancora da compilare: {giorno}, {orario}, {luogo}...
 *
 * I template "Pronti per te" (38 su 40 in prod) contengono campi tra graffe
 * che nessuno riempie: all'invio si risolve SOLO {nome} (template-variables.ts).
 * Senza questo controllo i genitori ricevevano letteralmente
 * "Convocazione partita {giorno} ore {orario}". Usato dalla modale (CTA
 * disattivata + campi evidenziati) e dal server (POST/PATCH rispondono 400
 * unfilled_placeholder), così nessun client può far partire le graffe.
 */

// Stesso alfabeto dei seed (solo lettere e _). {nome} resta valido: lo
// risolve il cron all'invio.
const PLACEHOLDER = /\{\s*([a-z][a-z_]*)\s*\}/gi;

/** I segnaposto non compilati, nell'ordine in cui compaiono, senza doppioni. */
export function unfilledPlaceholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of Array.from(text.matchAll(PLACEHOLDER))) {
    const name = m[1].toLowerCase();
    if (name === 'nome' || seen.has(name)) continue;
    seen.add(name);
    out.push(`{${name}}`);
  }
  return out;
}

/** "Completa i campi tra parentesi: {giorno}, {orario}" — null se non ne manca nessuno. */
export function unfilledPlaceholderMessage(text: string | null | undefined): string | null {
  const list = unfilledPlaceholders(text);
  if (list.length === 0) return null;
  return `Completa i campi tra parentesi: ${list.join(', ')}`;
}
