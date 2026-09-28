/**
 * Rilevamento automatico del foglio (indovina iniziale per i 4 angoli).
 *
 * Volutamente semplice, pensato per un'immagine già rimpicciolita (~256 px):
 *   1. soglia di Otsu sulla luminosità (il foglio è la cosa chiara, il tavolo no);
 *   2. la regione chiara connessa più grande;
 *   3. inviluppo convesso della regione e quadrilatero di area massima inscritto;
 *   4. controllo di "sicurezza": la regione deve riempire il quadrilatero.
 * Se qualcosa non torna ritorna null e l'editor parte dal rettangolo con margine:
 * meglio un ritaglio da sistemare a mano che un ritaglio sbagliato con aria sicura.
 */
import { orderQuad, quadArea, isConvexQuad, type Point, type Quad, type RgbaImage } from './geometry';

const MIN_CONTRAST = 40;          // differenza minima tra media "chiari" e "scuri"
const MIN_COVERAGE = 0.15;        // il foglio occupa almeno il 15% della foto
const FILL_MIN = 0.9, FILL_MAX = 1.08;
const MAX_HULL = 120;

function otsu(gray: Uint8Array): { t: number; contrast: number } {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = -1, t = 127, contrast = 0;
  for (let i = 0; i < 255; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; contrast = mF - mB; }
  }
  return { t, contrast };
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Inviluppo convesso (monotone chain), vertici in senso antiorario-matematico. */
function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function triArea(a: Point, b: Point, c: Point): number {
  return Math.abs(cross(a, b, c)) / 2;
}

/** Quadrilatero di area massima con vertici sull'inviluppo: O(n³), n ≤ 120 → pochi ms. */
function maxAreaQuad(hull: Point[]): Point[] | null {
  const n = hull.length;
  if (n < 4) return null;
  let best = -1, bestIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue;
      let bj = -1, aj = -1;
      for (let j = i + 1; j < k; j++) { const a = triArea(hull[i], hull[j], hull[k]); if (a > aj) { aj = a; bj = j; } }
      let bl = -1, al = -1;
      for (let l = k + 1; l < n + i; l++) {
        const ll = l % n;
        const a = triArea(hull[k], hull[ll], hull[i]);
        if (a > al) { al = a; bl = ll; }
      }
      if (bj < 0 || bl < 0) continue;
      if (aj + al > best) { best = aj + al; bestIdx = [i, bj, k, bl]; }
    }
  }
  return best > 0 ? bestIdx.map((i) => hull[i]) : null;
}

/**
 * Angoli del foglio nell'immagine data (stesse coordinate), o null se non è sicuro.
 * Chi chiama passa un'immagine piccola e riscala il risultato.
 */
export function detectDocumentQuad(img: RgbaImage): Quad | null {
  const { data, width: w, height: h } = img;
  const n = w * h;
  if (w < 8 || h < 8) return null;
  const gray = new Uint8Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) gray[i] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;

  const { t, contrast } = otsu(gray);
  if (contrast < MIN_CONTRAST) return null;

  // Regione chiara connessa (4-vicini) più grande, con una coda su Int32Array.
  const label = new Int32Array(n);
  const queue = new Int32Array(n);
  let bestLabel = 0, bestSize = 0, next = 0;
  for (let s = 0; s < n; s++) {
    if (label[s] !== 0 || gray[s] <= t) continue;
    next++;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = s; label[s] = next;
    while (head < tail) {
      const p = queue[head++]; size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && label[p - 1] === 0 && gray[p - 1] > t) { label[p - 1] = next; queue[tail++] = p - 1; }
      if (x < w - 1 && label[p + 1] === 0 && gray[p + 1] > t) { label[p + 1] = next; queue[tail++] = p + 1; }
      if (y > 0 && label[p - w] === 0 && gray[p - w] > t) { label[p - w] = next; queue[tail++] = p - w; }
      if (y < h - 1 && label[p + w] === 0 && gray[p + w] > t) { label[p + w] = next; queue[tail++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
  }
  if (bestSize < n * MIN_COVERAGE) return null;

  // Estremi per riga (i buchi del testo non contano) → angoli dei quadratini-pixel.
  const pts: Point[] = [];
  let filled = 0;
  for (let y = 0; y < h; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < w; x++) if (label[y * w + x] === bestLabel) { if (lo < 0) lo = x; hi = x; }
    if (lo < 0) continue;
    filled += hi - lo + 1;
    pts.push({ x: lo, y }, { x: lo, y: y + 1 }, { x: hi + 1, y }, { x: hi + 1, y: y + 1 });
  }
  let hull = convexHull(pts);
  if (hull.length > MAX_HULL) {
    const step = hull.length / MAX_HULL;
    hull = Array.from({ length: MAX_HULL }, (_, i) => hull[Math.floor(i * step)]);
  }
  const corners = maxAreaQuad(hull);
  if (!corners) return null;
  const quad = orderQuad(corners);
  if (!isConvexQuad(quad)) return null;
  const area = quadArea(quad);
  const fill = filled / area;
  if (fill < FILL_MIN || fill > FILL_MAX) return null;
  const minSide = Math.min(w, h) * 0.1;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    if (Math.hypot(a.x - b.x, a.y - b.y) < minSide) return null;
  }
  return quad;
}
