'use client';

import { useEffect } from 'react';

// Manual service-worker registration. @ducanh2912/next-pwa v10's auto-inject
// targets _document.tsx (Pages Router) and silently no-ops on App Router +
// output: 'standalone', so the SW shipped by the PWA build never registered
// in production until this component existed. Idempotent: navigator.serviceWorker
// .register on the same URL is a no-op after the first call.
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Don't pollute local dev — next.config.js disables PWA there, so /sw.js
    // doesn't exist and the fetch would 404 every reload.
    if (process.env.NODE_ENV !== 'production') return;

    // Defer until after first paint so we don't compete with critical work.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Swallow — Sentry will pick up real errors. SW registration failures
        // shouldn't break the app.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
