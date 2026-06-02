'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandaloneNow(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  if (!ios) return false;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

// Always-reachable "Installa app" control for the dashboard header. Complements
// the auto banner (InstallPrompt) and is the reliable fallback everywhere:
//  - Chrome/Android: fires the captured beforeinstallprompt (native install)
//  - iOS Safari (no beforeinstallprompt exists): shows Share -> Add to Home steps
//  - Other browsers / event not yet fired: shows a generic browser-menu hint
//  - Already installed (standalone): renders nothing
export default function InstallAppButton() {
  const [mounted, setMounted] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isStandaloneNow()) { setInstalled(true); return; }
    setIos(isIosSafari());
    const onBip = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setShowHint(false); };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (deferred) {
      try { await deferred.prompt(); await deferred.userChoice; } catch { /* user dismissed */ }
      setDeferred(null);
      return;
    }
    setShowHint(true);
  }, [deferred]);

  if (!mounted || installed) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Installa l'app WhatsLater"
        className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium text-primary border border-primary/40 hover:bg-primary/10 transition-colors whitespace-nowrap"
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Installa app</span>
      </button>

      {showHint && (
        <div
          role="dialog"
          aria-label="Come installare l'app"
          className="fixed inset-0 z-toast flex items-end sm:items-center justify-center bg-black/50 p-4"
          onClick={() => setShowHint(false)}
        >
          <div
            className="bg-[#1F2C33] border border-[#2A3942] rounded-2xl p-5 w-full sm:w-[360px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-white font-semibold text-base">Installa WhatsLater</h3>
              <button onClick={() => setShowHint(false)} aria-label="Chiudi" className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {ios ? (
              <ol className="text-sm text-gray-300 space-y-2 list-decimal list-inside">
                <li>Tocca <Share className="inline w-4 h-4" /> <strong>Condividi</strong> nella barra di Safari.</li>
                <li>Scegli <strong>&ldquo;Aggiungi a Home&rdquo;</strong>.</li>
                <li>Conferma con <strong>Aggiungi</strong>.</li>
              </ol>
            ) : (
              <p className="text-sm text-gray-300 leading-relaxed">
                Apri il menu del browser e scegli <strong>&ldquo;Installa app&rdquo;</strong> oppure <strong>&ldquo;Aggiungi a schermata Home&rdquo;</strong>. Su Chrome desktop trovi l&rsquo;icona di installazione nella barra degli indirizzi.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
