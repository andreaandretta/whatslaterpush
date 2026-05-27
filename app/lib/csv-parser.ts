// Minimal CSV parser. Handles:
//   - LF and CRLF row separators
//   - quoted fields with embedded commas, newlines, and "" escapes
//   - leading/trailing whitespace trimming on unquoted fields only
// Does NOT handle: BOM stripping, custom delimiters, escaped backslashes.
// Used by /api/contacts/import where the worst-case input is a small (<1000
// row) CSV with a name and phone column — anything fancier we reject upstream.

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

export function parseCsv(input: string): CsvParseResult {
  // Strip a UTF-8 BOM if present (Excel exports it).
  const text = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      current.push(field.trim());
      field = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      current.push(field.trim());
      field = '';
      // Skip the \n of a \r\n pair.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      // Don't emit empty trailing row.
      if (current.length > 1 || current[0] !== '') {
        rows.push(current);
      }
      current = [];
      continue;
    }
    field += ch;
    i++;
  }
  // Flush last field/row.
  if (field !== '' || current.length > 0) {
    current.push(field.trim());
    if (current.length > 1 || current[0] !== '') {
      rows.push(current);
    }
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return { headers, rows: rows.slice(1) };
}

// Italian phone normalizer. Accepts inputs like "333 123 4567", "+39 333 123 4567",
// "3331234567", "39 333 123 4567" and returns E.164 without leading + (matching
// the format the rest of WhatsLater uses: '393331234567'). Returns null when
// the input doesn't yield a recognizable IT mobile number.
export function normalizeItalianPhoneForCsv(raw: string): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 0) return null;
  // Already in E.164 with country code 39 + 10 digits (3xx for mobile, etc.)
  if (digits.startsWith('39') && digits.length >= 11 && digits.length <= 13) {
    return digits;
  }
  // Local without +39 (most common case): 10 digits starting with 3 (mobile).
  if (digits.length === 10 && digits.startsWith('3')) {
    return '39' + digits;
  }
  // Other length patterns we don't accept here — be conservative.
  return null;
}
