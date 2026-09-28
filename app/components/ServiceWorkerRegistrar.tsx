'use client';

import { useEffect } from 'react';
import { startSwUpdates } from '../lib/sw-update';
import { openModalLayerCount } from '../lib/use-modal-history';

// Manual service-worker registration. @ducanh2912/next-pwa v10's auto-inject
// targets _document.tsx (Pages Router) and silently no-ops on App Router +
// output: 'standalone', so the SW shipped by the PWA build never registered
// in production until this component existed. Idempotent: navigator.serviceWorker
// .register on the same URL is a no-op after the first call.
//
// Aggiornamento dopo un deploy: la versione nuova aspetta (skipWaiting spento in
// next.config.js) e si attiva/ricarica solo in un momento sicuro — app in
// background e nessuna modale aperta — mai a metà di un messaggio o di un upload.
// Al ritorno in primo piano si controlla se c'è una versione nuova (con freno).
// Dettagli e perché in app/lib/sw-update.ts.
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Don't pollute local dev — next.config.js disables PWA there, so /sw.js
    // doesn't exist and the fetch would 404 every reload.
    if (process.env.NODE_ENV !== 'production') return;

    let stop: (() => void) | null = null;
    // Defer registration until after first paint so we don't compete with
    // critical work.
    const start = () => {
      stop = startSwUpdates({
        sw: navigator.serviceWorker as unknown as Parameters<typeof startSwUpdates>[0]['sw'],
        doc: document,
        openLayers: openModalLayerCount,
        reload: () => window.location.reload(),
      });
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    return () => {
      window.removeEventListener('load', start);
      stop?.();
    };
  }, []);

  return null;
}
