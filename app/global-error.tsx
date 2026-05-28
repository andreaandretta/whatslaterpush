'use client';

// Catches React render errors in the App Router (server + client). Required
// by @sentry/nextjs to capture rendering failures — without this file Sentry
// never sees React errors above the route handlers. Italian copy matches the
// rest of the dashboard.
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="it">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480, margin: '4rem auto', color: '#1f2937' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Qualcosa è andato storto</h2>
        <p style={{ fontSize: '0.95rem', color: '#4b5563' }}>
          Abbiamo registrato l'errore. Riprova fra qualche secondo o ricarica la pagina.
        </p>
      </body>
    </html>
  );
}
