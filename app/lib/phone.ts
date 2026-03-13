/**
 * Unified phone normalization for WhatsLater.
 * Handles Italian numbers (mobile 3xx, landline 0xx) and international formats.
 */

export function normalizeItalianPhone(raw: string): string {
  if (!raw) return raw;
  const clean = raw.replace(/\D/g, '');
  if (clean.startsWith('0039')) return clean.substring(2); // 00393401234567 → 393401234567
  if (clean.startsWith('39') && clean.length >= 11) return clean;
  if (clean.startsWith('0')) return '39' + clean.substring(1);
  if (clean.startsWith('3') && clean.length === 10) return '39' + clean;
  return clean;
}

export function validatePhone(raw: string): string | null {
  const clean = raw.replace(/\D/g, '');
  if (clean.length < 10 || clean.length > 15) return null;
  return normalizeItalianPhone(clean);
}
