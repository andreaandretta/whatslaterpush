/**
 * Scansione documento — dalle pagine (JPEG già raddrizzati) a UN PDF.
 *
 * pdf-lib si carica con import dinamico: pesa ~200 KB e serve solo a chi scansiona,
 * non deve finire nel bundle della dashboard. Le pagine si incorporano una alla
 * volta (niente Promise.all): su telefono la memoria è poca.
 */

/** Larghezza A4 in punti: l'altezza segue le proporzioni della scansione. */
export const PDF_PAGE_WIDTH_PT = 595;
/** Tetto PDF sull'altezza di pagina (scontrini lunghissimi). */
const PDF_MAX_PAGE_PT = 14400;
/** ~250-400 KB a pagina a 1700 px: 5 pagine restano ben sotto il limite upload. */
export const SCAN_JPEG_QUALITY = 0.72;

export interface ScanPage { jpeg: Uint8Array; width: number; height: number }

export async function buildScanPdf(pages: ScanPage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('Nessuna pagina da salvare');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle('Scansione');
  doc.setCreator('WhatsLater');
  doc.setProducer('WhatsLater');
  for (const p of pages) {
    const img = await doc.embedJpg(p.jpeg);
    const width = PDF_PAGE_WIDTH_PT;
    const height = Math.min(PDF_MAX_PAGE_PT, (PDF_PAGE_WIDTH_PT * p.height) / Math.max(1, p.width));
    const page = doc.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
  }
  return doc.save();
}

/** "Scansione GG-MM-AAAA HH.MM.pdf" nell'ora di Roma, qualunque sia il fuso del telefono. */
export function scanFilename(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `Scansione ${get('day')}-${get('month')}-${get('year')} ${get('hour')}.${get('minute')}.pdf`;
}
