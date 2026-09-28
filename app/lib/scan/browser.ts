/**
 * Scansione documento — la parte che tocca il browser (canvas, Blob). La logica
 * vera sta nei moduli puri (geometry, filter, detect, pdf); qui solo I/O.
 *
 * Memoria: una foto del telefono è 12 Mpx (48 MB decodificata). La riduciamo
 * subito a 2000 px sul lato lungo, liberiamo i canvas appena finiti (width = 0
 * è il modo affidabile per farlo su iOS Safari) e lavoriamo una pagina alla volta.
 */
import { fitWithin } from '../upload-limits';
import { detectDocumentQuad } from './detect';
import { applyDocumentFilter } from './filter';
import { insetQuad, warpDims, warpPerspective, type Quad } from './geometry';
import { SCAN_JPEG_QUALITY, type ScanPage } from './pdf';

export const PHOTO_MAX_EDGE = 2000;
const DETECT_MAX_EDGE = 256;

export type ScanMode = 'document' | 'original';

export interface ProcessedPage { blob: Blob; width: number; height: number }

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  return ctx;
}

/** Libera la memoria del canvas (iOS la tiene altrimenti finché non passa il GC). */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (!c) return;
  c.width = 0; c.height = 0;
}

async function decodeWithImg(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Foto → canvas già ridotto a PHOTO_MAX_EDGE (orientamento EXIF applicato dal browser). */
export async function loadPhotoCanvas(file: File, maxEdge = PHOTO_MAX_EDGE): Promise<HTMLCanvasElement> {
  let source: ImageBitmap | HTMLImageElement | null = null;
  if (typeof createImageBitmap === 'function') {
    try { source = await createImageBitmap(file); } catch { source = null; }
  }
  if (!source) source = await decodeWithImg(file);
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!sw || !sh) throw new Error('image_empty');
  const { width, height } = fitWithin(sw, sh, maxEdge);
  const c = newCanvas(width, height);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source) source.close();
  return c;
}

/** Indovina gli angoli su una copia piccola; se non è sicuro, rettangolo con margine del 6%. */
export function guessQuad(photo: HTMLCanvasElement): Quad {
  try {
    const { width, height } = fitWithin(photo.width, photo.height, DETECT_MAX_EDGE);
    const small = newCanvas(width, height);
    const ctx = ctx2d(small);
    ctx.drawImage(photo, 0, 0, width, height);
    const found = detectDocumentQuad(ctx.getImageData(0, 0, width, height));
    releaseCanvas(small);
    if (found) {
      const kx = photo.width / width, ky = photo.height / height;
      return found.map((p) => ({ x: p.x * kx, y: p.y * ky })) as Quad;
    }
  } catch {
    // Il rilevamento è un aiuto, non un requisito: si parte dal rettangolo.
  }
  return insetQuad(photo.width, photo.height);
}

/** Ruota la foto di 90° in senso orario; il canvas vecchio viene liberato. */
export function rotateCanvas90(photo: HTMLCanvasElement): HTMLCanvasElement {
  const c = newCanvas(photo.height, photo.width);
  const ctx = ctx2d(c);
  ctx.translate(photo.height, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(photo, 0, 0);
  releaseCanvas(photo);
  return c;
}

function toJpeg(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b && b.size > 0 ? resolve(b) : reject(new Error('jpeg_encode_failed'))), 'image/jpeg', quality);
  });
}

/**
 * Raddrizza il ritaglio, applica il filtro e codifica JPEG. Legge dalla foto solo
 * il riquadro che contiene i 4 angoli: meno memoria sui telefoni.
 */
export async function renderPage(photo: HTMLCanvasElement, quad: Quad, mode: ScanMode): Promise<ProcessedPage> {
  const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
  const bx = Math.max(0, Math.floor(Math.min(...xs))), by = Math.max(0, Math.floor(Math.min(...ys)));
  const bw = Math.min(photo.width, Math.ceil(Math.max(...xs))) - bx;
  const bh = Math.min(photo.height, Math.ceil(Math.max(...ys))) - by;
  if (bw < 2 || bh < 2) throw new Error('quad_too_small');
  const src = ctx2d(photo).getImageData(bx, by, bw, bh);
  const local = quad.map((p) => ({ x: p.x - bx, y: p.y - by })) as Quad;
  const { width, height } = warpDims(local);
  const warped = warpPerspective(src, local, width, height);
  if (!warped) throw new Error('quad_degenerate');
  if (mode === 'document') applyDocumentFilter(warped);
  const out = newCanvas(width, height);
  const outImage = ctx2d(out).createImageData(width, height);
  outImage.data.set(warped.data);
  ctx2d(out).putImageData(outImage, 0, 0);
  try {
    const blob = await toJpeg(out, SCAN_JPEG_QUALITY);
    return { blob, width, height };
  } finally {
    releaseCanvas(out);
  }
}

export async function blobToScanPage(p: ProcessedPage): Promise<ScanPage> {
  return { jpeg: new Uint8Array(await p.blob.arrayBuffer()), width: p.width, height: p.height };
}

/**
 * Un frame di respiro prima del lavoro pesante: lo spinner deve comparire subito.
 * Con la scheda in background requestAnimationFrame non scatta (o scatta di rado):
 * il timeout di riserva evita che l'elaborazione resti appesa lì.
 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 100);
  });
}
