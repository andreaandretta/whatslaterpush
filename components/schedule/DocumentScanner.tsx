'use client';

/**
 * "Scansiona documento" (26 set 2026, richiesta del fondatore: "lo voglio
 * scannerizzare come fa WhatsApp nativo, non me lo fa fare, il pdf lo devo avere
 * già pronto"). Foto dalla fotocamera → ritaglio con 4 angoli trascinabili →
 * pagina raddrizzata (filtro "Documento" o "Originale") → più pagine → UN PDF.
 *
 * Tutto succede nel telefono: nessuna chiamata di rete qui. Il PDF esce come un
 * normale File e MediaPicker lo carica esattamente come un PDF scelto a mano.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Camera, Check, ChevronLeft, ChevronRight, Loader2, Plus, RotateCw, Trash2, AlertCircle } from 'lucide-react';
import { isConvexQuad, rotateQuad90, type Point, type Quad } from '../../app/lib/scan/geometry';
import {
  blobToScanPage, guessQuad, loadPhotoCanvas, nextFrame, releaseCanvas, renderPage, rotateCanvas90,
  type ScanMode,
} from '../../app/lib/scan/browser';
import { buildScanPdf, scanFilename, type ScanPage } from '../../app/lib/scan/pdf';
import { useModalHistory } from '../../app/lib/use-modal-history';

interface Props {
  /** Prima foto, scattata da MediaPicker (il tap sull'opzione apre già la fotocamera). */
  initialPhoto: File;
  onCancel: () => void;
  /**
   * Riceve il PDF e lo carica. Ritorna un messaggio d'errore se il caricamento
   * fallisce: lo scanner resta aperto sulle pagine, così si riprova con «Fatto»
   * senza rifotografare tutto (il PDF non esiste da nessun'altra parte).
   */
  onDone: (pdf: File) => void | Promise<string | null | void>;
}

interface Page { id: number; blob: Blob; url: string; width: number; height: number }
interface Edit { photo: HTMLCanvasElement; quad: Quad; rev: number }
type Phase = 'loading' | 'edit' | 'pages' | 'working' | 'failed';

const CORNER_LABELS = ['in alto a sinistra', 'in alto a destra', 'in basso a destra', 'in basso a sinistra'];
// Anteprima del filtro nell'editor: solo CSS (istantaneo). Il filtro vero, con la
// correzione delle ombre, gira sulla pagina raddrizzata al momento della conferma.
const DOCUMENT_PREVIEW_CSS = 'grayscale(1) contrast(1.35) brightness(1.08)';
const HANDLE_HIT_PX = 28;    // raggio dell'area di tocco: comodo col pollice
const HANDLE_DOT_PX = 11;

let pageSeq = 0;

export function DocumentScanner({ initialPhoto, onCancel, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [busyLabel, setBusyLabel] = useState('Apro la foto…');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [mode, setMode] = useState<ScanMode>('document');
  const [err, setErr] = useState<string | null>(null);
  // Angolo in trascinamento + distanza dito-angolo al momento della presa: l'angolo
  // non salta sotto il polpastrello (dove non si vedrebbe più).
  const dragRef = useRef<{ i: number; dx: number; dy: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const alive = useRef(true);
  // Copie "vive" per la pulizia allo smontaggio (le closure vedrebbero stato vecchio).
  const pagesRef = useRef<Page[]>([]);
  const editRef = useRef<Edit | null>(null);
  pagesRef.current = pages;
  editRef.current = edit;

  useEffect(() => {
    alive.current = true;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      alive.current = false;
      pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
      releaseCanvas(editRef.current?.photo);
      previouslyFocused?.focus?.();
    };
  }, []);

  const replaceEdit = useCallback((next: Edit | null) => {
    setEdit((prev) => {
      if (prev && prev.photo !== next?.photo) releaseCanvas(prev.photo);
      return next;
    });
  }, []);

  const loadPhoto = useCallback(async (file: File) => {
    setErr(null);
    setBusyLabel('Apro la foto…');
    setPhase('loading');
    try {
      await nextFrame();
      const photo = await loadPhotoCanvas(file);
      const quad = guessQuad(photo);
      if (!alive.current) { releaseCanvas(photo); return; }
      replaceEdit({ photo, quad, rev: Date.now() });
      setPhase('edit');
    } catch {
      if (!alive.current) return;
      setErr('Non riesco ad aprire questa foto. Riprova a scattarla.');
      setPhase(pagesRef.current.length > 0 ? 'pages' : 'failed');
    }
  }, [replaceEdit]);

  useEffect(() => { loadPhoto(initialPhoto); }, [initialPhoto, loadPhoto]);

  // Disegna la foto nel canvas visibile quando cambia (nuovo scatto o rotazione).
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || !edit || phase !== 'edit') return;
    view.width = edit.photo.width;
    view.height = edit.photo.height;
    view.getContext('2d')?.drawImage(edit.photo, 0, 0);
  }, [edit?.photo, edit?.rev, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dimensione a schermo della foto: la più grande che sta nello spazio disponibile.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !edit || phase !== 'edit') return;
    const fit = () => {
      const r = stage.getBoundingClientRect();
      const k = Math.min(r.width / edit.photo.width, r.height / edit.photo.height);
      if (k > 0 && Number.isFinite(k)) setBox({ w: Math.floor(edit.photo.width * k), h: Math.floor(edit.photo.height * k) });
    };
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [edit?.photo, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus sul titolo a ogni cambio di schermata: chi usa lo screen reader sa dov'è.
  useEffect(() => { headingRef.current?.focus(); }, [phase]);

  function openCamera() {
    // Click sincrono dentro il tap: iOS apre la fotocamera solo da un gesto utente.
    camRef.current?.click();
  }

  /** true = lo scanner si chiude; false = resta aperto (conferma annullata). */
  function requestClose(): boolean {
    if (pagesRef.current.length > 0 && !window.confirm('Scartare la scansione? Le pagine fatte andranno perse.')) return false;
    onCancel();
    return true;
  }

  /**
   * Indietro: dall'editor con pagine già fatte torna all'elenco, altrimenti chiude.
   * Ritorna true solo se lo scanner si chiude (serve al tasto Indietro di sistema).
   */
  function back(): boolean {
    if (phase === 'working' || phase === 'loading') return false;
    if (phase === 'edit' && pagesRef.current.length > 0) {
      replaceEdit(null);
      setErr(null);
      setPhase('pages');
      return false;
    }
    return requestClose();
  }

  // Tasto Indietro di Android / swipe iOS: stesso comportamento della freccia in alto.
  useModalHistory(true, () => back());

  // Esc e Tab ascoltati su document (fase di cattura), non sul div dello scanner:
  // Safari non mette il focus sui bottoni toccati e in 'loading'/'working' l'unico
  // bottone è disattivato, quindi il focus finiva su <body> o sulla modale sotto
  // e la tastiera "usciva" dallo scanner. Il ref tiene la versione fresca di back().
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const root = rootRef.current;
    if (!root) return;
    if (e.key === 'Escape') {
      // Solo lo scanner: la modale e la sheet sotto non devono chiudersi insieme.
      e.stopPropagation();
      e.preventDefault();
      back();
      return;
    }
    if (e.key !== 'Tab') return;
    // Trappola del focus: il Tab resta dentro lo scanner a tutto schermo.
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const active = document.activeElement;
    if (focusables.length === 0) { e.preventDefault(); headingRef.current?.focus(); return; }
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (!active || !root.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && (active === first || active === headingRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // ── Editor: trascinamento degli angoli ────────────────────────────────────
  function toPhotoPoint(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current;
    if (!svg || !edit) return null;
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return clampToPhoto({
      x: ((clientX - r.left) / r.width) * edit.photo.width,
      y: ((clientY - r.top) / r.height) * edit.photo.height,
    });
  }

  function clampToPhoto(p: Point): Point {
    if (!edit) return p;
    return { x: Math.min(edit.photo.width, Math.max(0, p.x)), y: Math.min(edit.photo.height, Math.max(0, p.y)) };
  }

  function moveCorner(i: number, p: Point) {
    setEdit((prev) => {
      if (!prev) return prev;
      const quad = prev.quad.map((q, k) => (k === i ? p : q)) as Quad;
      return { ...prev, quad };
    });
    setErr(null);
  }

  function onHandleKey(i: number, e: React.KeyboardEvent) {
    if (!edit) return;
    const step = (e.shiftKey ? 20 : 4) * (box ? edit.photo.width / box.w : 1);
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const mv = d[e.key];
    if (!mv) return;
    e.preventDefault();
    const q = edit.quad[i];
    moveCorner(i, clampToPhoto({ x: q.x + mv[0], y: q.y + mv[1] }));
  }

  function rotate() {
    if (!edit) return;
    const quad = rotateQuad90(edit.quad, edit.photo.height);
    const photo = rotateCanvas90(edit.photo);
    // rotateCanvas90 ha già liberato la foto vecchia: niente replaceEdit qui.
    setEdit({ photo, quad, rev: Date.now() });
  }

  async function confirmPage() {
    if (!edit) return;
    if (!isConvexQuad(edit.quad)) {
      setErr('Gli angoli si incrociano: sistemali prima di continuare.');
      return;
    }
    setBusyLabel('Raddrizzo la pagina…');
    setPhase('working');
    try {
      await nextFrame();
      const out = await renderPage(edit.photo, edit.quad, mode);
      if (!alive.current) return;
      const page: Page = { id: ++pageSeq, blob: out.blob, url: URL.createObjectURL(out.blob), width: out.width, height: out.height };
      replaceEdit(null);
      setPages((prev) => [...prev, page]);
      setErr(null);
      setPhase('pages');
    } catch {
      if (!alive.current) return;
      setErr('Non riesco a elaborare questa pagina. Sistema gli angoli o rifai la foto.');
      setPhase('edit');
    }
  }

  // ── Elenco pagine ─────────────────────────────────────────────────────────
  function deletePage(id: number) {
    setPages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function movePage(index: number, delta: number) {
    setPages((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  async function finish() {
    const list = pagesRef.current;
    if (list.length === 0) return;
    setBusyLabel(list.length > 1 ? `Creo il PDF (${list.length} pagine)…` : 'Creo il PDF…');
    setPhase('working');
    try {
      await nextFrame();
      // Una pagina alla volta: sui telefoni la memoria è poca.
      const scanPages: ScanPage[] = [];
      for (const p of list) scanPages.push(await blobToScanPage(p));
      const bytes = await buildScanPdf(scanPages);
      if (!alive.current) return;
      setBusyLabel('Carico il PDF…');
      const failure = await onDone(new File([bytes as BlobPart], scanFilename(new Date()), { type: 'application/pdf' }));
      if (!alive.current) return; // caricato: MediaPicker ha già chiuso lo scanner
      if (typeof failure === 'string' && failure) {
        // Upload fallito: le pagine sono ancora qui, «Fatto» riprova.
        setErr(`${failure} Tocca «Fatto» per riprovare.`);
        setPhase('pages');
      }
    } catch {
      if (!alive.current) return;
      setErr('Non sono riuscito a creare il PDF. Riprova.');
      setPhase('pages');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const inEdit = phase === 'edit' && edit;
  const title = inEdit
    ? `Ritaglia la pagina ${pages.length + 1}`
    : phase === 'pages'
      ? (pages.length === 1 ? '1 pagina' : `${pages.length} pagine`)
      : 'Scansiona documento';
  const backLabel = phase === 'edit' && pages.length > 0 ? 'Annulla questa pagina' : 'Chiudi scansione';
  const unit = inEdit && box ? edit.photo.width / box.w : 1; // pixel foto per pixel schermo

  const ui = (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-title"
      className="fixed inset-0 z-dialog bg-[#0B141A] text-white flex flex-col"
    >
      <header className="flex items-center gap-2 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 shrink-0">
        <button
          type="button"
          onClick={back}
          aria-label={backLabel}
          disabled={phase === 'working' || phase === 'loading'}
          className="w-11 h-11 inline-flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 id="scanner-title" ref={headingRef} tabIndex={-1} className="flex-1 font-semibold truncate focus:outline-none">{title}</h2>
      </header>

      {err && (
        <div role="alert" className="mx-4 mb-2 flex items-start gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-200">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {(phase === 'loading' || phase === 'working') && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3" aria-live="polite">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-gray-300">{busyLabel}</p>
        </div>
      )}

      {phase === 'failed' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
          <button type="button" onClick={openCamera} className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-semibold text-white">
            <Camera className="w-5 h-5" /> Scatta di nuovo
          </button>
        </div>
      )}

      {inEdit && (
        <>
          <div className="flex-1 min-h-0 px-4 py-2">
            <div ref={stageRef} className="w-full h-full flex items-center justify-center">
              <div className="relative" style={box ? { width: box.w, height: box.h } : { width: '100%', height: '100%' }}>
                <canvas
                  ref={viewRef}
                  aria-label="Foto del documento"
                  role="img"
                  className="block w-full h-full rounded-md"
                  style={{ filter: mode === 'document' ? DOCUMENT_PREVIEW_CSS : undefined }}
                />
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${edit.photo.width} ${edit.photo.height}`}
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full"
                  style={{ touchAction: 'none' }}
                  onPointerMove={(e) => {
                    const d = dragRef.current;
                    if (!d) return;
                    const p = toPhotoPoint(e.clientX, e.clientY);
                    if (p) moveCorner(d.i, clampToPhoto({ x: p.x + d.dx, y: p.y + d.dy }));
                  }}
                  onPointerUp={() => { dragRef.current = null; }}
                  onPointerCancel={() => { dragRef.current = null; }}
                >
                  {/* Fuori dal ritaglio scurito: si vede subito cosa finirà nella pagina. */}
                  <path
                    fillRule="evenodd"
                    fill="rgba(0,0,0,0.45)"
                    d={`M0 0H${edit.photo.width}V${edit.photo.height}H0Z M${edit.quad.map((p) => `${p.x} ${p.y}`).join(' L')}Z`}
                  />
                  <polygon
                    points={edit.quad.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#25D366"
                    strokeWidth={2 * unit}
                  />
                  {edit.quad.map((p, i) => (
                    <g
                      key={i}
                      role="button"
                      tabIndex={0}
                      aria-label={`Angolo ${CORNER_LABELS[i]}: trascina o usa le frecce`}
                      onKeyDown={(e) => onHandleKey(i, e)}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                        const at = toPhotoPoint(e.clientX, e.clientY);
                        dragRef.current = { i, dx: at ? p.x - at.x : 0, dy: at ? p.y - at.y : 0 };
                      }}
                      style={{ cursor: 'grab', outline: 'none' }}
                    >
                      <circle cx={p.x} cy={p.y} r={HANDLE_HIT_PX * unit} fill="transparent" />
                      <circle cx={p.x} cy={p.y} r={HANDLE_DOT_PX * unit} fill="rgba(37,211,102,0.25)" stroke="#25D366" strokeWidth={2.5 * unit} />
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          </div>

          <div className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={openCamera} aria-label="Rifai la foto" className="flex flex-col items-center gap-1 w-16 py-1 rounded-xl hover:bg-white/10 text-xs text-gray-200">
                <Camera className="w-5 h-5" /> Rifai
              </button>
              <button type="button" onClick={rotate} aria-label="Ruota la foto di 90 gradi" className="flex flex-col items-center gap-1 w-16 py-1 rounded-xl hover:bg-white/10 text-xs text-gray-200">
                <RotateCw className="w-5 h-5" /> Ruota
              </button>
              <div role="radiogroup" aria-label="Filtro" className="flex rounded-full bg-[#2A3942] p-1 text-xs">
                {(['document', 'original'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-2 rounded-full ${mode === m ? 'bg-primary text-white font-semibold' : 'text-gray-300'}`}
                  >
                    {m === 'document' ? 'Documento' : 'Originale'}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={confirmPage}
              className="w-full flex items-center justify-center gap-2 rounded-full bg-primary py-3 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              <Check className="w-5 h-5" /> Conferma ritaglio
            </button>
          </div>
        </>
      )}

      {phase === 'pages' && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
            {pages.length === 0 ? (
              <p className="text-center text-sm text-gray-400 mt-10">Nessuna pagina. Tocca «Aggiungi pagina» per scattare.</p>
            ) : (
              <ol className="grid grid-cols-2 gap-3">
                {pages.map((p, i) => (
                  <li key={p.id} className="relative rounded-xl bg-[#1F2C33] p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Pagina ${i + 1}`} className="w-full aspect-[3/4] object-contain rounded-md bg-white" />
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-gray-300">Pag. {i + 1}</span>
                      <div className="flex items-center">
                        <button type="button" onClick={() => movePage(i, -1)} disabled={i === 0} aria-label={`Sposta pagina ${i + 1} prima`} className="w-9 h-9 inline-flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => movePage(i, 1)} disabled={i === pages.length - 1} aria-label={`Sposta pagina ${i + 1} dopo`} className="w-9 h-9 inline-flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => deletePage(p.id)} aria-label={`Elimina pagina ${i + 1}`} className="w-9 h-9 inline-flex items-center justify-center rounded-full hover:bg-white/10 text-red-300">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="shrink-0 flex gap-3 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
            <button type="button" onClick={openCamera} className="flex-1 flex items-center justify-center gap-2 rounded-full bg-[#2A3942] py-3 font-semibold text-white">
              <Plus className="w-5 h-5" /> Aggiungi pagina
            </button>
            <button type="button" onClick={finish} disabled={pages.length === 0} className="flex-1 flex items-center justify-center gap-2 rounded-full bg-primary py-3 font-semibold text-white disabled:opacity-40">
              <Check className="w-5 h-5" /> Fatto
            </button>
          </div>
        </>
      )}

      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="scanner-camera-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) loadPhoto(f);
        }}
      />
    </div>
  );

  // Portale su body: la sheet di MediaPicker ha un'animazione con transform, che
  // intrappolerebbe un `position: fixed` dentro di lei invece che a tutto schermo.
  return typeof document !== 'undefined' ? createPortal(ui, document.body) : ui;
}

export default DocumentScanner;
