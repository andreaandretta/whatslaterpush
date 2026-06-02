'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Share, X, CheckCircle2, MoreVertical } from 'lucide-react';

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

// Heuristic for a phone/tablet with "Request desktop site" ON. Chrome then
// sends a desktop UA (no "Mobile" token) and SUPPRESSES beforeinstallprompt /
// PWA install entirely, so the native prompt can never fire — no code can
// override it. We detect a coarse (touch) primary pointer + multi-touch + a
// desktop-looking UA, and tell the user to turn Desktop site off (the real fix).
function isDesktopSiteOnTouch(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const looksDesktop = !/Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  return touch && coarse && looksDesktop;
}

// Persistent "Installa app" control in the dashboard header — always visible
// unless already installed.
//  - Native prompt ready (Chrome/Android/desktop): click fires ONLY the native
//    prompt, then a green "App installata!" toast on accept.
//  - No native prompt: a readable sheet — iOS shows Share -> Add to Home,
//    desktop-site-on-phone tells the user to turn Desktop site off, otherwise a
//    generic browser-menu hint.
//  - Already installed (standalone): renders nothing.
export default function InstallAppButton() {
  const [mounted, setMounted] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [desktopMode, setDesktopMode] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const celebrate = useCallback(() => {
    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 3500);
  }, []);

  useEffect(() => {
    setMounted(true);
    if (isStandaloneNow()) { setInstalled(true); return; }
    setIos(isIosSafari());
    setDesktopMode(isDesktopSiteOnTouch());
    // Pick up a beforeinstallprompt captured before React hydrated (inline
    // script in layout) — covers fast cached loads where it fires early.
    const pre = (window as unknown as { __wlBip?: BeforeInstallPromptEvent }).__wlBip;
    if (pre) setDeferred(pre);
    const onBip = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setShowSheet(false); celebrate(); };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [celebrate]);

  const handleClick = useCallback(async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === 'accepted') celebrate();
      } catch { /* user dismissed */ }
      setDeferred(null);
      try { (window as unknown as { __wlBip?: unknown }).__wlBip = null; } catch { /* ignore */ }
      return;
    }
    setShowSheet(true);
  }, [deferred, celebrate]);

  if (!mounted) return null;

  return (
    <>
      {!installed && (
        <button
          type="button"
          onClick={handleClick}
          aria-label="Installa l'app WhatsLater"
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium text-primary border border-primary/40 hover:bg-primary/10 transition-colors whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Installa app</span>
        </button>
      )}

      {!installed && showSheet && (
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
