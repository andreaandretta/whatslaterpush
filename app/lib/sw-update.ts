/**
 * Quando e come la pagina passa alla versione nuova dopo un deploy.
 *
 * Prima: il SW generato faceva skipWaiting + clientsClaim e il registrar
 * ricaricava la pagina a ogni controllerchange, senza guardare niente. Chi
 * riapriva l'app dopo un deploy si vedeva ricaricare la pagina pochi secondi
 * dopo, anche a metà di un messaggio o di un upload. Al contrario, un'app iOS
 * ripresa dal background non chiamava mai registration.update() e poteva restare
 * sul bundle vecchio (senza le correzioni lato client) finché iOS non la uccideva.
 *
 * Ora (next.config.js: workboxOptions.skipWaiting = false) la versione nuova si
 * installa e ASPETTA. La attiviamo noi (messaggio SKIP_WAITING, già gestito dal
 * SW generato da Workbox) solo in un momento sicuro:
 *   - l'app è in background (visibilitychange → hidden), e
 *   - nessuna modale/foglio è aperto (vedi use-modal-history: un messaggio in
 *     scrittura, un upload o una scansione vivono tutti dentro uno strato aperto).
 * Il reload su controllerchange segue la stessa regola: se in quel momento c'è
 * uno strato aperto (es. la versione l'ha attivata un'altra scheda) si rimanda al
 * prossimo momento sicuro.
 * Al ritorno in primo piano si chiede al browser se c'è una versione nuova,
 * al massimo una volta ogni UPDATE_CHECK_MIN_MS.
 */

export const UPDATE_CHECK_MIN_MS = 5 * 60_000;

interface WorkerLike { postMessage: (msg: unknown) => void; state?: string; addEventListener?: (t: string, cb: () => void) => void }
interface RegistrationLike {
  waiting: WorkerLike | null;
  installing?: WorkerLike | null;
  update: () => Promise<unknown>;
  addEventListener?: (t: string, cb: () => void) => void;
}
interface ContainerLike {
  controller: unknown;
  register: (url: string, opts?: RegistrationOptions) => Promise<RegistrationLike>;
  addEventListener: (t: string, cb: () => void) => void;
  removeEventListener: (t: string, cb: () => void) => void;
}

export interface SwUpdateDeps {
  sw: ContainerLike;
  doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  /** Strati aperti (modali, fogli, scanner): 0 = momento sicuro. */
  openLayers: () => number;
  reload: () => void;
  now?: () => number;
}

/** Registra /sw.js e gestisce l'aggiornamento. Ritorna la funzione di pulizia. */
export function startSwUpdates(deps: SwUpdateDeps): () => void {
  const { sw, doc, openLayers, reload } = deps;
  const now = deps.now ?? (() => Date.now());
  // Pagina già controllata da un SW = chi torna, non la prima installazione
  // (dove la pagina è già fresca dalla rete e il reload non serve).
  const hadController = !!sw.controller;
  let reg: RegistrationLike | null = null;
  let refreshing = false;
  let reloadPending = false;
  let lastCheck = now();
  let stopped = false;

  const safe = () => openLayers() === 0;
  const hidden = () => doc.visibilityState === 'hidden';

  const reloadOnce = () => {
    if (refreshing) return;
    refreshing = true;
    reload();
  };

  const activateWaiting = () => {
    const waiting = reg?.waiting;
    if (!waiting || !sw.controller) return;
    if (!hidden() || !safe()) return;
    try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch { /* ignore */ }
  };

  const onControllerChange = () => {
    if (!hadController) return;
    if (safe()) reloadOnce();
    else reloadPending = true;
  };

  const onVisibility = () => {
    if (hidden()) {
      if (reloadPending && safe()) { reloadOnce(); return; }
      activateWaiting();
      return;
    }
    if (reg && now() - lastCheck >= UPDATE_CHECK_MIN_MS) {
      lastCheck = now();
      reg.update().catch(() => { /* offline: si riprova al prossimo ritorno */ });
    }
  };

  sw.addEventListener('controllerchange', onControllerChange);
  doc.addEventListener('visibilitychange', onVisibility);

  sw.register('/sw.js', { scope: '/' }).then((r) => {
    if (stopped) return;
    reg = r;
    // Versione nuova installata mentre siamo già in background: attivala ora.
    r.addEventListener?.('updatefound', () => {
      const nw = r.installing;
      nw?.addEventListener?.('statechange', () => { if (nw.state === 'installed') activateWaiting(); });
    });
    activateWaiting();
  }).catch(() => {
    // Swallow — Sentry will pick up real errors. SW registration failures
    // shouldn't break the app.
  });

  return () => {
    stopped = true;
    sw.removeEventListener('controllerchange', onControllerChange);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
