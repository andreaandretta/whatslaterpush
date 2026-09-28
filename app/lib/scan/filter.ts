/**
 * Filtro "Documento": bianco e nero nitido, come gli scanner da telefono.
 *
 * Una soglia globale non basta: sulla foto di un foglio c'è quasi sempre l'ombra
 * della mano o del telefono, e la carta in ombra è più scura del testo in luce.
 * Si divide quindi ogni pixel per la luminosità media del suo intorno (immagine
 * integrale → costo lineare, niente dipendenze): la carta diventa ~1, il testo
 * resta ben sotto, qualunque sia l'illuminazione locale.
 */
import type { RgbaImage } from './geometry';

// Rapporto pixel/intorno: da WHITE_AT in su è carta (bianco pieno), da BLACK_AT in
// giù è inchiostro (nero). In mezzo una curva che scurisce i toni medi, così anche
// il testo sottile o un po' sfocato resta leggibile.
const WHITE_AT = 0.9;
const BLACK_AT = 0.5;
const GAMMA = 1.5;

const LUT_STEPS = 512; // rapporto 0..2 quantizzato a 1/256
let lut: Uint8Array | null = null;
function ratioLut(): Uint8Array {
  if (lut) return lut;
  lut = new Uint8Array(LUT_STEPS);
  for (let i = 0; i < LUT_STEPS; i++) {
    const r = i / 256;
    const n = Math.min(1, Math.max(0, (r - BLACK_AT) / (WHITE_AT - BLACK_AT)));
    lut[i] = Math.round(255 * Math.pow(n, GAMMA));
  }
  return lut;
}

/** Applica il filtro in place (alfa invariato) e ritorna la stessa immagine. */
export function applyDocumentFilter(img: RgbaImage): RgbaImage {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const gray = new Uint8Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    gray[i] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
  }
  // Immagine integrale (w+1)x(h+1): 255 x 4M pixel sta in un Uint32.
  const W = w + 1;
  const integral = new Uint32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  // Finestra ~1/20 del lato corto: più larga di una riga di testo, più stretta di un'ombra.
  const r = Math.max(4, Math.round(Math.min(w, h) / 20));
  const table = ratioLut();
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const idx = mean > 0 ? Math.min(LUT_STEPS - 1, Math.round((gray[y * w + x] / mean) * 256)) : LUT_STEPS - 1;
      const v = table[idx];
      const o = (y * w + x) * 4;
      data[o] = v; data[o + 1] = v; data[o + 2] = v;
    }
  }
  return img;
}
