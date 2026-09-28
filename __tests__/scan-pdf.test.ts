/**
 * Scansione documento — il PDF finale. Deve essere un PDF vero (riletto con
 * pdf-lib), una pagina per scansione, proporzioni della foto, e con un nome che
 * il cliente capisce ("Scansione 28-09-2026 14.05.pdf", ora di Roma).
 */
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { buildScanPdf, scanFilename, PDF_PAGE_WIDTH_PT, SCAN_JPEG_QUALITY } from '../app/lib/scan/pdf';

const jpeg = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'public', 'hero-dashboard.jpg')));

describe('buildScanPdf', () => {
  test('one page per scan, A4 width, height following each image aspect', async () => {
    const bytes = await buildScanPdf([
      { jpeg, width: 1200, height: 1700 },
      { jpeg, width: 1700, height: 1200 },
      { jpeg, width: 1000, height: 1000 },
    ]);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const sizes = doc.getPages().map((p) => p.getSize());
    expect(sizes[0].width).toBe(PDF_PAGE_WIDTH_PT);
    expect(sizes[0].height).toBeCloseTo((PDF_PAGE_WIDTH_PT * 1700) / 1200, 3);
    expect(sizes[1].height).toBeCloseTo((PDF_PAGE_WIDTH_PT * 1200) / 1700, 3);
    expect(sizes[2].height).toBeCloseTo(PDF_PAGE_WIDTH_PT, 3);
    expect(doc.getTitle()).toBe('Scansione');
  });

  test('refuses an empty scan instead of producing an empty PDF', async () => {
    await expect(buildScanPdf([])).rejects.toThrow();
  });

  test('JPEG quality stays around 0.72 so a 5-page scan fits the upload limit', () => {
    expect(SCAN_JPEG_QUALITY).toBeGreaterThanOrEqual(0.65);
    expect(SCAN_JPEG_QUALITY).toBeLessThanOrEqual(0.8);
  });
});

describe('scanFilename', () => {
  test('uses Rome time (summer, UTC+2)', () => {
    expect(scanFilename(new Date('2026-09-28T12:05:00Z'))).toBe('Scansione 28-09-2026 14.05.pdf');
  });
  test('uses Rome time (winter, UTC+1) across midnight, never "24.xx"', () => {
    expect(scanFilename(new Date('2026-01-15T23:30:00Z'))).toBe('Scansione 16-01-2026 00.30.pdf');
  });
});
