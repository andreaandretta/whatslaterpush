'use client';

/**
 * Tasto Indietro di Android / swipe dal bordo su iOS con una modale aperta.
 *
 * Prima: nessuna modale scriveva nella cronologia. La PWA parte da /dashboard con
 * UNA sola voce di cronologia, quindi "Indietro" chiudeva l'app intera (in una
 * scheda del browser usciva dalla pagina) e il messaggio in scrittura spariva.
 *
 * Ora ogni "strato" aperto (ContactPicker, ScheduleModal, i suoi fogli, la
 * graffetta, lo scanner) aggiunge una voce di cronologia con la stessa URL.
 * "Indietro" consuma quella voce: arriva un popstate e si chiude SOLO lo strato
 * più in alto. Quando uno strato si chiude dai suoi bottoni, la sua voce viene
 * tolta (history.go(-n)), così non restano "Indietro" a vuoto.
 *
 * Convivenza col router di Next (14.2): la voce nuova copia lo stato interno
 * della voce corrente (__NA + albero), quindi al popstate Next fa un RESTORE
 * della stessa pagina, senza ricaricare né navigare. Non tocchiamo mai la URL.
 * Se nel frattempo il router ha navigato altrove, NON si torna indietro alla
 * cieca (si finirebbe sulla pagina precedente): la voce vecchia resta e basta.
 *
 * Ogni voce porta la sua profondità (1 = primo strato). Tutto il resto si
 * ricava confrontando quella profondità con quanti strati sono aperti: regge
 * anche il passaggio ContactPicker → ScheduleModal (uno si chiude e l'altro si
 * apre nello stesso render: la voce viene riusata, niente back+push in gara).
 */
import { useEffect, useRef } from 'react';

/** Ritorna false per restare aperto (es. conferma annullata): la voce si ripristina. */
export type ModalBackHandler = () => boolean | void;

interface Layer { onBack: () => boolean | void }

const STATE_KEY = '__wlModal';

const stack: Layer[] = [];
// Quante nostre voci crediamo ci siano sopra la voce di base della pagina.
let pushed = 0;
let trimTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function depthOf(state: unknown): number {
  const v = state && typeof state === 'object' ? (state as Record<string, unknown>)[STATE_KEY] : undefined;
  return typeof v === 'number' && v > 0 ? v : 0;
}

function pushEntry(depth: number) {
  try {
    const cur = window.history.state;
    const base = cur && typeof cur === 'object' ? cur : {};
    window.history.pushState({ ...base, [STATE_KEY]: depth }, '');
    pushed = depth;
  } catch {
    // History bloccata (sandbox, browser strani): la modale funziona lo stesso.
  }
}

function onPopState(e: PopStateEvent) {
  const depth = depthOf(e.state);
  if (depth >= stack.length) {
    // Avanti su una voce vecchia (o nostro go() di pulizia): niente da chiudere.
    pushed = depth;
    if (depth > stack.length) scheduleTrim();
    return;
  }
  pushed = depth;
  // Si chiude dall'alto. Di solito è uno strato solo.
  while (stack.length > depth) {
    const layer = stack.pop()!;
    let result: boolean | void;
    try { result = layer.onBack(); } catch { result = undefined; }
    if (result === false) {
      // Lo strato ha scelto di restare (es. "Scartare la scansione?" → Annulla):
      // rimetto la sua voce, così il prossimo Indietro lo richiude.
      stack.push(layer);
      pushEntry(stack.length);
      return;
    }
  }
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('popstate', onPopState);
  listening = true;
}

/** Toglie dalla cronologia le voci degli strati chiusi dai loro bottoni. */
function scheduleTrim() {
  if (trimTimer !== null || typeof window === 'undefined') return;
  // setTimeout 0: se nello stesso render uno strato si chiude e un altro si apre
  // (ContactPicker → ScheduleModal), la voce passa al nuovo invece di fare
  // back() + push() in gara tra loro.
  trimTimer = setTimeout(() => {
    trimTimer = null;
    const extra = pushed - stack.length;
    if (extra <= 0) return;
    let current = 0;
    try { current = depthOf(window.history.state); } catch { /* ignore */ }
    if (current !== pushed) {
      // La cronologia si è mossa sotto di noi (il router ha navigato): tornare
      // indietro ora porterebbe via l'utente dalla pagina nuova.
      pushed = Math.min(current, stack.length);
      return;
    }
    pushed = stack.length;
    try { window.history.go(-extra); } catch { /* ignore */ }
  }, 0);
}

function openLayer(layer: Layer) {
  ensureListener();
  stack.push(layer);
  const depth = stack.length;
  // Una voce a questa profondità c'è già (lasciata da uno strato appena chiuso):
  // la si riusa; l'eventuale eccesso sopra la toglie la pulizia.
  if (pushed >= depth) scheduleTrim();
  else pushEntry(depth);
}

function releaseLayer(layer: Layer) {
  const i = stack.indexOf(layer);
  if (i === -1) return; // già tolto dal popstate (chiusura via Indietro)
  stack.splice(i, 1);
  scheduleTrim();
}

/** Strati aperti in questo momento: il service worker ricarica solo a zero. */
export function openModalLayerCount(): number {
  return stack.length;
}

/**
 * Registra uno strato finché `active` è vero. `onBack` viene chiamato quando
 * l'utente preme Indietro con questo strato in cima.
 */
export function useModalHistory(active: boolean, onBack: ModalBackHandler): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const layer: Layer = { onBack: () => onBackRef.current() };
    openLayer(layer);
    return () => releaseLayer(layer);
  }, [active]);
}

/** Solo test: riparte da zero. */
export function __resetModalHistoryForTests() {
  stack.length = 0;
  pushed = 0;
  if (trimTimer !== null) clearTimeout(trimTimer);
  trimTimer = null;
}
