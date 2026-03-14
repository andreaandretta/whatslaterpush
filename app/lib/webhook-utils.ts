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

// ── Smart datetime parsing: handles offset-aware and offset-naive ISO strings ──
export function parseAIDatetime(datetimeStr: string): Date {
  const aiDate = new Date(datetimeStr);
  if (isNaN(aiDate.getTime())) throw new Error('Invalid date: ' + datetimeStr);
  const hasOffset = /([+-]\d{2}:\d{2}|Z)\s*$/.test(datetimeStr);
  return hasOffset ? aiDate : romeToUtc(aiDate);
}
