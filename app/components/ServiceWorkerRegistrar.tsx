'use client';

import { useEffect } from 'react';

// Manual service-worker registration. @ducanh2912/next-pwa v10's auto-inject
// targets _document.tsx (Pages Router) and silently no-ops on App Router +
// output: 'standalone', so the SW shipped by the PWA build never registered
// in production until this component existed. Idempotent: navigator.serviceWorker
// .register on the same URL is a no-op after the first call.
//
// Auto-update: the generated SW uses skipWaiting + clientsClaim, so a new SW
// activates and claims clients on its own. We reload the page once on
// `controllerchange` so the currently-open tab swaps to the new version without
// the user clearing cache by hand — guarded against reload loops and against
// the first install (where there was no previous controller and the page is
// already fresh from the network).
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Don't pollute local dev — next.config.js disables PWA there, so /sw.js
    // doesn't exist and the fetch would 404 every reload.
    if (process.env.NODE_ENV !== 'production') return;

    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    const onControllerChange = () => {
      // Reload only on a genuine update (page was already controlled), and only
      // once (controllerchange can fire more than once).
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // Defer registration until after first paint so we don't compete with
    // critical work.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Swallow — Sentry will pick up real errors. SW registration failures
        // shouldn't break the app.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
