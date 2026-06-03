'use client';

import { useCallback, useEffect, useState } from 'react';
import { Share, X, CheckCircle2, MoreVertical } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

// Compact install pill in the dashboard header. Single tap path:
//  - Native prompt available (Chrome/Android/desktop) → fire it, then a
//    "App installata!" toast on accept.
//  - No native prompt → open a sheet with the right copy for iOS,
//    desktop-site-on-phone, or generic browser menu.
//  - Already installed (standalone) → renders nothing.
//
// Label collapses to "Installa" under sm: to fit the 48px header at 360px.
export default function InstallAppButton() {
  const { mounted, installed, deferred, ios, desktopMode, install } = useInstallPrompt();
  const [showSheet, setShowSheet] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const celebrate = useCallback(() => {
    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 3500);
  }, []);

  // appinstalled may fire from outside this button too (e.g. the user
  // installs from the browser menu); close any open sheet and toast then.
  useEffect(() => {
    const onInstalled = () => { setShowSheet(false); celebrate(); };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [celebrate]);

  const handleClick = useCallback(async () => {
    if (deferred) {
      const outcome = await install();
      if (outcome === 'accepted') celebrate();
      return;
    }
    setShowSheet(true);
  }, [deferred, install, celebrate]);

  if (!mounted || installed) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Installa l'app WhatsLater"
        className="flex items-center justify-center gap-1 h-10 px-2.5 bg-[#25D366] hover:bg-[#1DA851] text-[#0b141a] text-xs font-semibold rounded-lg focus-visible:ring-2 focus-visible:ring-[#25D366] transition-colors whitespace-nowrap"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="6" y="2" width="12" height="20" rx="3" />
          <path d="M12 7v6" />
          <path d="m9.5 10.5 2.5 2.5 2.5-2.5" />
        </svg>
        <span className="sm:hidden">Installa</span>
        <span className="hidden sm:inline">Installa app</span>
      </button>

      {showSheet && (
        <div
          role="dialog"
          aria-label="Come installare l'app"
          className="fixed inset-0 z-toast flex items-end sm:items-center justify-center bg-black/60 p-4"
          onClick={() => setShowSheet(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1F2C33] border border-[#2A3942] rounded-2xl p-5 w-full min-w-[240px] sm:w-[360px] max-w-[92vw] shadow-2xl"
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-white font-semibold text-[15px]">Installa WhatsLater</h3>
              <button onClick={() => setShowSheet(false)} aria-label="Chiudi" className="text-gray-300 hover:text-white shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            {ios ? (
              <ol className="text-[13px] leading-relaxed text-gray-200 space-y-2 list-decimal list-inside">
                <li>Tocca <Share className="inline w-4 h-4 align-text-bottom" /> <strong>Condividi</strong> nella barra di Safari.</li>
                <li>Scegli <strong>&ldquo;Aggiungi a Home&rdquo;</strong>.</li>
                <li>Conferma con <strong>Aggiungi</strong>.</li>
              </ol>
            ) : desktopMode ? (
              <div className="text-[13px] leading-relaxed text-gray-200 space-y-2">
                <p>Hai la modalit&agrave; <strong>&ldquo;Sito desktop&rdquo;</strong> attiva: in questa modalit&agrave; Chrome non consente di installare l&rsquo;app.</p>
                <ol className="space-y-2 list-decimal list-inside">
                  <li>Tocca <MoreVertical className="inline w-4 h-4 align-text-bottom" /> in Chrome.</li>
                  <li><strong>Deseleziona &ldquo;Sito desktop&rdquo;</strong>.</li>
                  <li>Ricarica e tocca di nuovo <strong>Installa app</strong>.</li>
                </ol>
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-gray-200">
                Apri il menu del browser (i tre puntini in alto) e scegli <strong>&ldquo;Installa app&rdquo;</strong> oppure <strong>&ldquo;Aggiungi a schermata Home&rdquo;</strong>. Su Chrome desktop trovi l&rsquo;icona di installazione nella barra degli indirizzi.
              </p>
            )}
          </div>
        </div>
      )}

      {showToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-toast">
          <div className="flex items-center gap-2 bg-green-600 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-2xl whitespace-nowrap">
            <CheckCircle2 className="w-4 h-4" /> App installata!
          </div>
        </div>
      )}
    </>
  );
}
