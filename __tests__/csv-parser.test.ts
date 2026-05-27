import { parseCsv, normalizeItalianPhoneForCsv } from '../app/lib/csv-parser';

describe('parseCsv', () => {
  test('parses simple CSV with header and rows', () => {
    const { headers, rows } = parseCsv('name,phone\nMario,3331234567\nAnna,3402345678');
    expect(headers).toEqual(['name', 'phone']);
    expect(rows).toEqual([['Mario', '3331234567'], ['Anna', '3402345678']]);
  });

  test('handles CRLF row separators', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(rows).toEqual([['1', '2'], ['3', '4']]);
  });

  test('handles quoted fields containing commas', () => {
    const { rows } = parseCsv('name,phone\n"Rossi, Mario",3331234567');
    expect(rows[0]).toEqual(['Rossi, Mario', '3331234567']);
  });

  test('handles escaped quotes "" inside quoted field', () => {
    const { rows } = parseCsv('name,phone\n"He said ""hi""",3331234567');
    expect(rows[0][0]).toBe('He said "hi"');
  });

  test('lowercases headers for case-insensitive matching', () => {
    const { headers } = parseCsv('Nome,TELEFONO\nAnna,3331234567');
    expect(headers).toEqual(['nome', 'telefono']);
  });

  test('strips UTF-8 BOM from Excel exports', () => {
    const bom = '﻿';
    const { headers, rows } = parseCsv(bom + 'name,phone\nAnna,3331234567');
    expect(headers[0]).toBe('name'); // not '﻿name'
    expect(rows[0]).toEqual(['Anna', '3331234567']);
  });

  test('skips empty trailing rows', () => {
    const { rows } = parseCsv('name,phone\nMario,3331234567\n\n');
    expect(rows.length).toBe(1);
  });

  test('returns empty result for empty input', () => {
    const { headers, rows } = parseCsv('');
    expect(headers).toEqual([]);
    expect(rows).toEqual([]);
  });
});

describe('normalizeItalianPhoneForCsv', () => {
  test('accepts already-normalized 39 + 10 digits', () => {
    expect(normalizeItalianPhoneForCsv('393331234567')).toBe('393331234567');
  });

  test('strips spaces and adds 39 for plain 10-digit mobile', () => {
    expect(normalizeItalianPhoneForCsv('333 123 4567')).toBe('393331234567');
  });

  test('strips + sign and assumes E.164', () => {
    expect(normalizeItalianPhoneForCsv('+39 333 123 4567')).toBe('393331234567');
  });

  test('strips dashes and parens', () => {
    expect(normalizeItalianPhoneForCsv('(333) 123-4567')).toBe('393331234567');
  });

  test('returns null for 10-digit not starting with 3 (landline)', () => {
    expect(normalizeItalianPhoneForCsv('0521234567')).toBeNull();
  });

  test('returns null for too-short input', () => {
    expect(normalizeItalianPhoneForCsv('1234')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(normalizeItalianPhoneForCsv('')).toBeNull();
    expect(normalizeItalianPhoneForCsv('   ')).toBeNull();
  });
});
