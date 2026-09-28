/**
 * Scansione documento — geometria pura (26 set 2026, richiesta del fondatore:
 * "voglio scannerizzare come fa WhatsApp nativo"). L'omografia porta i 4 angoli
 * scelti sulla foto in un rettangolo: se sbaglia anche solo un angolo, la pagina
 * esce storta nel PDF che arriva al cliente.
 */
import {
  computeHomography, applyHomography, warpDims, insetQuad, orderQuad, rotateQuad90,
  warpPerspective, quadArea, type Quad,
} from '../app/lib/scan/geometry';

function near(a: number, b: number, eps = 1e-6) {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe('computeHomography / applyHomography', () => {
  test('identity: a quad mapped onto itself leaves every point in place', () => {
    const q: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const H = computeHomography(q, q)!;
    expect(H).not.toBeNull();
    for (const p of [{ x: 0, y: 0 }, { x: 37, y: 12 }, { x: 100, y: 50 }, { x: 81.5, y: 3.25 }]) {
      const r = applyHomography(H, p.x, p.y);
      near(r.x, p.x); near(r.y, p.y);
    }
  });

  test('maps the 4 corners of a skewed quad exactly onto the rectangle corners', () => {
    const src: Quad = [{ x: 112, y: 80 }, { x: 905, y: 140 }, { x: 860, y: 1210 }, { x: 60, y: 1100 }];
    const dst: Quad = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 1100 }, { x: 0, y: 1100 }];
    const H = computeHomography(src, dst)!;
    src.forEach((p, i) => {
      const r = applyHomography(H, p.x, p.y);
      near(r.x, dst[i].x, 1e-6); near(r.y, dst[i].y, 1e-6);
    });
    // Il centro prospettico (incrocio delle diagonali) finisce al centro del rettangolo.
    const c = applyHomography(H, ...diagonalCross(src));
    near(c.x, 400, 1e-6); near(c.y, 550, 1e-6);
  });

  test('a degenerate quad (three collinear corners) returns null instead of garbage', () => {
    const bad: Quad = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }];
    const dst: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(computeHomography(bad, dst)).toBeNull();
  });
});

function diagonalCross(q: Quad): [number, number] {
  // Intersezione di tl→br con tr→bl.
  const [a, b, c, d] = [q[0], q[2], q[1], q[3]];
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  return [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)];
}

describe('warpDims', () => {
  test('output size comes from the longest opposite edges', () => {
    const q: Quad = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 380, y: 600 }, { x: 20, y: 580 }];
    const d = warpDims(q, 5000);
    expect(d.width).toBe(400);
    expect(d.height).toBe(Math.round(Math.hypot(20, 600)));
  });

  test('never exceeds the long-edge cap and keeps the aspect ratio', () => {
    const q: Quad = [{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 1500, y: 2000 }, { x: 0, y: 2000 }];
    expect(warpDims(q, 1700)).toEqual({ width: 1275, height: 1700 });
  });
});

describe('quad helpers', () => {
  test('insetQuad leaves a 6% margin by default', () => {
    expect(insetQuad(1000, 500)).toEqual([
      { x: 60, y: 30 }, { x: 940, y: 30 }, { x: 940, y: 470 }, { x: 60, y: 470 },
    ]);
  });

  test('orderQuad returns tl, tr, br, bl whatever the input order', () => {
    const shuffled = [{ x: 90, y: 95 }, { x: 5, y: 8 }, { x: 10, y: 90 }, { x: 95, y: 4 }];
    expect(orderQuad(shuffled)).toEqual([{ x: 5, y: 8 }, { x: 95, y: 4 }, { x: 90, y: 95 }, { x: 10, y: 90 }]);
  });

  test('rotateQuad90 follows the photo when it is turned clockwise', () => {
    // Foto 200x100: dopo la rotazione diventa 100x200; il vecchio angolo in basso a
    // sinistra (0,100) diventa quello in alto a sinistra (0,0).
    const q: Quad = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
    expect(rotateQuad90(q, 100)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }]);
  });

  test('quadArea of a rectangle', () => {
    expect(quadArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50);
  });
});

describe('warpPerspective', () => {
  test('crops an axis-aligned quad exactly (bilinear on pixel centres)', () => {
    // 4x4 con un quadrato 2x2 al centro: valori distinti per ogni pixel.
    const w = 4, h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = i * 10; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255; }
    const quad: Quad = [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }];
    const out = warpPerspective({ data, width: w, height: h }, quad, 2, 2)!;
    expect(Array.from([0, 1, 2, 3].map((i) => out.data[i * 4]))).toEqual([50, 60, 90, 100]);
    expect(out.data[3]).toBe(255);
  });

  test('straightens a rotated square back into the same colours', () => {
    // Quadrato ruotato: metà sinistra rossa, metà destra blu nel sistema del foglio.
    const w = 120, h = 120;
    const data = new Uint8ClampedArray(w * h * 4);
    const quad: Quad = [{ x: 60, y: 10 }, { x: 110, y: 60 }, { x: 60, y: 110 }, { x: 10, y: 60 }];
    const H = computeHomography(quad, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])!;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = applyHomography(H, x + 0.5, y + 0.5).x;
      const o = (y * w + x) * 4;
      data[o] = u < 0.5 ? 255 : 0; data[o + 2] = u < 0.5 ? 0 : 255; data[o + 3] = 255;
    }
    const out = warpPerspective({ data, width: w, height: h }, quad, 40, 40)!;
    const px = (x: number, y: number) => out.data[(y * 40 + x) * 4];
    expect(px(5, 20)).toBe(255);   // rosso a sinistra
    expect(px(35, 20)).toBe(0);    // blu a destra
    expect(out.data[(20 * 40 + 35) * 4 + 2]).toBe(255);
  });
});
