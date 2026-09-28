/**
 * Scansione documento — filtro "Documento" e rilevamento automatico dei bordi.
 * Il filtro deve rendere il foglio bianco e il testo nero anche con l'ombra del
 * telefono sopra; il rilevamento deve trovare il foglio chiaro sul tavolo scuro
 * oppure dire "non sono sicuro" (→ rettangolo con margine), mai inventare.
 */
import { applyDocumentFilter } from '../app/lib/scan/filter';
import { detectDocumentQuad } from '../app/lib/scan/detect';
import type { Quad, Point, RgbaImage } from '../app/lib/scan/geometry';

function gray(w: number, h: number, value: (x: number, y: number) => number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = value(x, y), o = (y * w + x) * 4;
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
  }
  return { data, width: w, height: h };
}

const lum = (img: RgbaImage, x: number, y: number) => img.data[(y * img.width + x) * 4];

describe('applyDocumentFilter', () => {
  test('paper becomes white, ink stays dark, output is grayscale and alpha is preserved', () => {
    const ink = new Set(['3,3', '4,3', '3,4', '4,4']);
    const img = gray(8, 8, (x, y) => (ink.has(`${x},${y}`) ? 40 : 190));
    // Un pixel colorato: dopo il filtro deve essere grigio (r = g = b).
    img.data[(0 * 8 + 7) * 4] = 200; img.data[(0 * 8 + 7) * 4 + 1] = 150; img.data[(0 * 8 + 7) * 4 + 2] = 90;
    img.data[3] = 128;
    applyDocumentFilter(img);
    expect(lum(img, 0, 7)).toBe(255);
    expect(lum(img, 3, 3)).toBeLessThan(60);
    const o = 7 * 4;
    expect(img.data[o]).toBe(img.data[o + 1]);
    expect(img.data[o + 1]).toBe(img.data[o + 2]);
    expect(img.data[3]).toBe(128);
  });

  test('uneven lighting: a shadowed paper edge still turns white while text on it stays dark', () => {
    // Carta da 110 (in ombra, a sinistra) a 230 (luce, a destra), testo a -60 dal fondo.
    const w = 64, h = 16;
    const paper = (x: number) => 110 + (120 * x) / (w - 1);
    const isInk = (x: number, y: number) => y === 8 && x % 8 === 4;
    const img = gray(w, h, (x, y) => (isInk(x, y) ? paper(x) - 60 : paper(x)));
    applyDocumentFilter(img);
    expect(lum(img, 1, 2)).toBe(255);        // carta in ombra
    expect(lum(img, 60, 2)).toBe(255);       // carta in luce
    expect(lum(img, 4, 8)).toBeLessThan(110); // testo in ombra
    expect(lum(img, 60, 8)).toBeLessThan(140); // testo in luce
  });
});

function insidePoly(poly: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('detectDocumentQuad', () => {
  test('finds a tilted white sheet on a dark desk (with text lines on it)', () => {
    const sheet: Quad = [{ x: 60, y: 30 }, { x: 200, y: 45 }, { x: 185, y: 170 }, { x: 40, y: 150 }];
    const img = gray(256, 192, (x, y) => {
      if (!insidePoly(sheet, x + 0.5, y + 0.5)) return 45 + ((x * 7 + y * 13) % 20);
      return y % 12 === 0 && x > 80 && x < 170 ? 60 : 225; // righe di testo
    });
    const t0 = Date.now();
    const q = detectDocumentQuad(img);
    expect(Date.now() - t0).toBeLessThan(300);
    expect(q).not.toBeNull();
    q!.forEach((p, i) => {
      expect(Math.abs(p.x - sheet[i].x)).toBeLessThanOrEqual(4);
      expect(Math.abs(p.y - sheet[i].y)).toBeLessThanOrEqual(4);
    });
  });

  test('a sheet rotated by ~40 degrees keeps its 4 real corners in tl/tr/br/bl order', () => {
    const c = { x: 128, y: 128 }, a = (40 * Math.PI) / 180, hw = 70, hh = 95;
    const rot = (dx: number, dy: number) => ({ x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) });
    const corners = [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)];
    const img = gray(256, 256, (x, y) => (insidePoly(corners, x + 0.5, y + 0.5) ? 215 : 70));
    const q = detectDocumentQuad(img);
    expect(q).not.toBeNull();
    // Ogni angolo trovato è vicino a uno degli angoli veri (l'ordine dipende dalla rotazione).
    for (const p of q!) {
      expect(Math.min(...corners.map((k) => Math.hypot(k.x - p.x, k.y - p.y)))).toBeLessThan(4);
    }
    expect(q![0].x + q![0].y).toBe(Math.min(...q!.map((p) => p.x + p.y)));
  });

  test('a uniform photo (white sheet on a white table) gives up instead of guessing', () => {
    expect(detectDocumentQuad(gray(128, 96, (x, y) => 200 + ((x + y) % 7)))).toBeNull();
  });

  test('a bright blob that is not a quadrilateral (a round plate) gives up', () => {
    const img = gray(160, 120, (x, y) => (Math.hypot(x - 80, y - 60) < 45 ? 230 : 40));
    expect(detectDocumentQuad(img)).toBeNull();
  });

  test('a tiny bright spot (a lamp reflection) is not a document', () => {
    const img = gray(160, 120, (x, y) => (x > 70 && x < 85 && y > 50 && y < 62 ? 250 : 50));
    expect(detectDocumentQuad(img)).toBeNull();
  });
});
