'use client';

/**
 * Finestre e tastiera su iPhone (rapporto 360 del 2 ott, B1: T2, T9, M6, M8).
 *
 * Su iPhone la tastiera NON accorcia la pagina: copre la parte bassa e Safari
 * sposta solo la parte visibile (window.visualViewport). Le finestre a tutto
 * schermo erano `fixed inset-0`, cioè alte quanto la pagina intera: con la
 * tastiera aperta la testata (← e ×) usciva in alto, "Invia" finiva sotto la
 * barra delle frecce e il primo tocco chiudeva solo la tastiera.
 *
 * Finché c'è almeno una finestra o un foglio aperto (vedi use-modal-history):
 *  - `--wl-vv-height` e `--wl-vv-top` sull'<html> dicono altezza e posizione
 *    della parte visibile; la classe `.wl-viewport` (globals.css) le usa, così
 *    la finestra sta tutta sopra la tastiera, con la testata in cima;
 *  - classe `wl-layer-open` sull'<html>: pagina sotto bloccata, niente "tira giù
 *    per ricaricare" (overscroll-behavior), barra della dashboard nascosta;
 *  - classe `wl-keyboard-open` mentre la tastiera è aperta (toglie le righe
 *    grigie di contorno) e il campo attivo viene portato in vista.
 * Senza visualViewport (browser vecchi, jsdom) restano i valori di riserva
 * del CSS (tutta l'altezza, come `inset-0`): come prima.
 */

const LAYER_CLASS = 'wl-layer-open';
const KEYBOARD_CLASS = 'wl-keyboard-open';
export const VV_HEIGHT_VAR = '--wl-vv-height';
export const VV_TOP_VAR = '--wl-vv-top';
// Sotto questa differenza tra pagina e parte visibile non è la tastiera (barre
// di Safari che si allargano, arrotondamenti).
const KEYBOARD_MIN_PX = 120;

let open = false;
let frame: number | null = null;
let revealTimer: ReturnType<typeof setTimeout> | null = null;
let keyboardOpen = false;

function root(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

function visualViewport(): VisualViewport | null {
  return typeof window !== 'undefined' && window.visualViewport ? window.visualViewport : null;
}

/** Il campo in cui si sta scrivendo, se sta dentro una finestra. */
function focusedField(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement as HTMLElement | null;
  if (!el || typeof el.closest !== 'function' || !el.closest('.wl-viewport')) return null;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return el;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type === 'checkbox' || type === 'radio' || type === 'file' || type === 'button' ? null : el;
  }
  return null;
}

// Dopo che la finestra si è accorciata sopra la tastiera, il campo può restare
// sotto, nella parte che scorre: lo si porta in vista, il minimo indispensabile.
function scheduleReveal() {
  if (revealTimer !== null) clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    revealTimer = null;
    const el = focusedField();
    if (!el || typeof el.scrollIntoView !== 'function') return;
    try { el.scrollIntoView({ block: 'nearest' }); } catch { /* browser vecchio */ }
  }, 60);
}

function measure() {
  frame = null;
  const el = root();
  const vv = visualViewport();
  if (!open || !el || !vv) return;
  el.style.setProperty(VV_HEIGHT_VAR, `${Math.round(vv.height)}px`);
  el.style.setProperty(VV_TOP_VAR, `${Math.round(vv.offsetTop)}px`);
  // Con lo zoom la parte visibile è più piccola anche senza tastiera: lì non si decide.
  const layoutHeight = el.clientHeight || window.innerHeight;
  const unzoomed = !vv.scale || Math.abs(vv.scale - 1) < 0.01;
  const kb = unzoomed && layoutHeight - vv.height > KEYBOARD_MIN_PX;
  if (kb !== keyboardOpen) {
    keyboardOpen = kb;
    el.classList.toggle(KEYBOARD_CLASS, kb);
  }
  if (kb) scheduleReveal();
}

function scheduleMeasure() {
  if (frame !== null) return;
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(measure);
  else measure();
}

// Tastiera già aperta e si passa a un altro campo (dal messaggio al titolo del
// modello): nessun resize, ma il campo nuovo può essere fuori vista.
function onFocusIn() {
  if (keyboardOpen) scheduleReveal();
}

function start() {
  const el = root();
  if (!el) return;
  el.classList.add(LAYER_CLASS);
  const vv = visualViewport();
  if (vv) {
    vv.addEventListener('resize', scheduleMeasure);
    vv.addEventListener('scroll', scheduleMeasure);
    measure();
  }
  document.addEventListener('focusin', onFocusIn);
}

function stop() {
  const el = root();
  const vv = visualViewport();
  if (vv) {
    vv.removeEventListener('resize', scheduleMeasure);
    vv.removeEventListener('scroll', scheduleMeasure);
  }
  if (typeof document !== 'undefined') document.removeEventListener('focusin', onFocusIn);
  if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  frame = null;
  if (revealTimer !== null) clearTimeout(revealTimer);
  revealTimer = null;
  keyboardOpen = false;
  if (!el) return;
  el.classList.remove(LAYER_CLASS, KEYBOARD_CLASS);
  el.style.removeProperty(VV_HEIGHT_VAR);
  el.style.removeProperty(VV_TOP_VAR);
}

/** Chiamata da use-modal-history quando si apre il primo strato o si chiude l'ultimo. */
export function setPageLayerOpen(next: boolean): void {
  if (next === open || typeof window === 'undefined') return;
  open = next;
  if (next) start();
  else stop();
}

export function isPageLayerOpen(): boolean {
  return open;
}

/** Solo test: riparte da zero. */
export function __resetPageLayerForTests(): void {
  if (open) stop();
  open = false;
}
