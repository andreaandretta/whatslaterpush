/**
 * Pure utility functions extracted from webhook/route.ts for testability.
 * These are imported by both the webhook route and tests.
 */

// ── Rome timezone helpers ──
export function getRomeOffsetMs(): number {
  const now = new Date();
  const utcStr = now.toLocaleString('en-CA', { timeZone: 'UTC', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const romeStr = now.toLocaleString('en-CA', { timeZone: 'Europe/Rome', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return new Date(romeStr.replace(', ', 'T')).getTime() - new Date(utcStr.replace(', ', 'T')).getTime();
}

export function nowRome(): Date {
  return new Date(new Date().getTime() + getRomeOffsetMs());
}

export function romeToUtc(d: Date): Date {
  return new Date(d.getTime() - getRomeOffsetMs());
}

// ── ILIKE escape (prevents wildcard injection) ──
export function escapeIlike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ── Inline recipient/message extraction ──
export function extractInlineRecipient(text: string): string | null {
  const m = /\b(?:manda|mandami|mandagli|mandale|scrivi|scrivimi|scrivigli|scrivile|invia|inviami|avvisa|avvisami|dici|digli|dille|ricordami|promemoria|reminder|comunica)\s+ad?\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{0,25}?)(?=\s+(?:domani|fra|tra|stasera|stamattina|stanotte|all[ae]?\s+\d|il\s+\d|\d{1,2}[\/\-]\d))/i.exec(text);
  return m ? m[1].trim() : null;
}

export function extractInlineMessage(text: string): string | null {
  const idx = text.indexOf(': ');
  if (idx > -1 && idx < text.length - 2) return text.substring(idx + 2).trim();
  return null;
}

import { validatePhone } from './phone';

/**
 * Estrae numero di telefono e nome inline dal testo.
 * Esempio: "Invia a Mario Cementi 3331234567 alle 17: msg"
 *   → { phone: "393331234567", name: "Mario Cementi", textWithoutPhone: "Invia a Mario Cementi  alle 17: msg" }
 *
 * Regole:
 * - Numero: cattura sequenze di cifre/separatori con >=7 cifre dopo pulizia.
 *   Una sequenza che sembra una data (DD/MM/YYYY) viene scartata.
 * - Nome: 1-3 parole maiuscole CONTIGUE che precedono immediatamente il numero.
 */
export function extractInlinePhoneAndName(text: string): {
  phone: string | null;
  name: string | null;
  textWithoutPhone: string;
} {
  // Pattern data DD/MM/YYYY o DD/MM/YY — scartato
  const datePattern = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

  // Pattern numero: opzionale +, poi cifre con possibili spazi/trattini/parentesi/punti, min 7 cifre dopo pulizia
  const phonePattern = /(\+?\d[\d\s\-().]{6,})/g;

  let foundPhone: string | null = null;
  let foundMatch: string | null = null;
  let foundIdx: number = -1;

  let match;
  while ((match = phonePattern.exec(text)) !== null) {
    const raw = match[1].trim();
    // Skip if this candidate IS a date
    if (datePattern.test(raw)) continue;
    // Strip non-digits except leading +
    const digitsOnly = raw.replace(/[^\d+]/g, '');
    const normalized = validatePhone(digitsOnly);
    if (normalized) {
      foundPhone = normalized;
      foundMatch = match[1];
      foundIdx = match.index;
      break;
    }
  }

  if (!foundPhone || !foundMatch) {
    return { phone: null, name: null, textWithoutPhone: text };
  }

  const before = text.substring(0, foundIdx);

  // Nome: 1-3 parole maiuscole contigue immediatamente prima del numero
  const nameMatch = before.match(/((?:[A-ZÀ-Ü][\wÀ-ÿ]+)(?:\s+[A-ZÀ-Ü][\wÀ-ÿ]+){0,2})\s*$/);
  const name = nameMatch ? nameMatch[1].trim() : null;

  // Rimuove il numero dal testo
  const textWithoutPhone = text.substring(0, foundIdx) + text.substring(foundIdx + foundMatch.length);

  return { phone: foundPhone, name, textWithoutPhone };
}

// ── Smart datetime parsing: handles offset-aware and offset-naive ISO strings ──
export function parseAIDatetime(datetimeStr: string): Date {
  const aiDate = new Date(datetimeStr);
  if (isNaN(aiDate.getTime())) throw new Error('Invalid date: ' + datetimeStr);
  const hasOffset = /([+-]\d{2}:\d{2}|Z)\s*$/.test(datetimeStr);
  return hasOffset ? aiDate : romeToUtc(aiDate);
}
