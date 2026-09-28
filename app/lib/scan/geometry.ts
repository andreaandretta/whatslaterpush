/**
 * Scansione documento — geometria pura (niente DOM, niente canvas: testabile in node).
 *
 * Il fotografo non tiene mai il telefono parallelo al foglio: il foglio arriva come
 * un quadrilatero storto. Con i 4 angoli (scelti a mano o indovinati da detect.ts)
 * calcoliamo l'omografia verso un rettangolo e "raddrizziamo" la pagina, come fa
 * lo scanner di WhatsApp. Tutto in TS puro: OpenCV pesa megabyte, qui servono
 * poche decine di righe.
 */
import { fitWithin } from '../upload-limits';

export interface Point { x: number; y: number }
/** Sempre nell'ordine alto-sx, alto-dx, basso-dx, basso-sx. */
export type Quad = [Point, Point, Point, Point];
/** Matrice 3x3 per righe, h[8] = 1. */
export type Homography = number[];

export interface RgbaImage { data: Uint8ClampedArray; width: number; height: number }

/** Lato lungo massimo della pagina raddrizzata: 5 pagine restano ben sotto il limite upload. */
export const SCAN_MAX_EDGE = 1700;

/**
 * Omografia che porta src[i] in dst[i] (4 coppie → sistema lineare 8x8).
 * Ritorna null se il quadrilatero è degenere (angoli allineati): meglio un
 * fallback che una pagina piena di NaN.
 */
export function computeHomography(src: Quad, dst: Quad): Homography | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Eliminazione di Gauss con pivot parziale.
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    if (piv !== col) { const t = A[col]; A[col] = A[piv]; A[piv] = t; }
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  if (h.some((v) => !Number.isFinite(v))) return null;
  h.push(1);
  return h;
}

export function applyHomography(H: Homography, x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Dimensioni della pagina raddrizzata: i lati opposti più lunghi danno larghezza e
 * altezza (il lato più vicino all'obiettivo è quello meno schiacciato), poi il tetto
 * sul lato lungo mantenendo le proporzioni.
 */
export function warpDims(q: Quad, maxEdge = SCAN_MAX_EDGE): { width: number; height: number } {
  const w = Math.max(1, Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2]))));
  const h = Math.max(1, Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2]))));
  return fitWithin(w, h, maxEdge);
}

/** Rettangolo con margine: il punto di partenza quando il rilevamento automatico non è sicuro. */
export function insetQuad(width: number, height: number, frac = 0.06): Quad {
  const dx = Math.round(width * frac), dy = Math.round(height * frac);
  return [
    { x: dx, y: dy }, { x: width - dx, y: dy },
    { x: width - dx, y: height - dy }, { x: dx, y: height - dy },
  ];
}

/** Rimette 4 punti qualsiasi in ordine alto-sx, alto-dx, basso-dx, basso-sx (giro orario). */
export function orderQuad(pts: Point[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  // Angolo attorno al baricentro: con y verso il basso, atan2 crescente = senso orario.
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  return [0, 1, 2, 3].map((k) => ({ ...sorted[(start + k) % 4] })) as Quad;
}

/**
 * Il quadrilatero segue la foto quando la si ruota di 90° in senso orario
 * (`srcHeight` = altezza PRIMA della rotazione, che diventa la nuova larghezza).
 */
export function rotateQuad90(q: Quad, srcHeight: number): Quad {
  return orderQuad(q.map((p) => ({ x: srcHeight - p.y, y: p.x })));
}

/** Area (formula del laccio): serve al rilevamento per capire se è "sicuro". */
export function quadArea(q: Point[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** true se i 4 angoli formano un quadrilatero convesso (niente lati incrociati). */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

/**
 * Raddrizza `quad` della sorgente in un'immagine outW x outH con campionamento
 * bilineare. Per ogni pixel d'uscita risale al punto della foto (mappa inversa):
 * così non restano buchi. Ritorna null se il quadrilatero è degenere.
 */
export function warpPerspective(src: RgbaImage, quad: Quad, outW: number, outH: number): RgbaImage | null {
  const rect: Quad = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }];
  const H = computeHomography(rect, quad);
  if (!H) return null;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sw = src.width, sh = src.height, sd = src.data;
  const maxX = sw - 1, maxY = sh - 1;
  let o = 0;
  for (let v = 0; v < outH; v++) {
    const yc = v + 0.5;
    // Termini costanti sulla riga, poi incremento per colonna: ~2M pixel in < 100 ms su telefono.
    let nx = H[0] * 0.5 + H[1] * yc + H[2];
    let ny = H[3] * 0.5 + H[4] * yc + H[5];
    let nw = H[6] * 0.5 + H[7] * yc + H[8];
    for (let u = 0; u < outW; u++) {
      // Centri dei pixel: la coordinata continua x corrisponde al pixel x - 0.5.
      let x = nx / nw - 0.5;
      let y = ny / nw - 0.5;
      if (x < 0) x = 0; else if (x > maxX) x = maxX;
      if (y < 0) y = 0; else if (y > maxY) y = maxY;
      const x0 = x | 0, y0 = y | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      out[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      out[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      out[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      out[o + 3] = 255;
      o += 4;
      nx += H[0]; ny += H[3]; nw += H[6];
    }
  }
  return { data: out, width: outW, height: outH };
}
