'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';

// Chrome/Android: emitted on installable PWAs, lets us defer the native prompt
// until we've earned the right to ask (post first scheduled message).
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const FIRST_MSG_FLAG = 'wl_first_msg_done';
const DISMISSED_FLAG = 'wl_install_dismissed';
const FIRST_MSG_EVENT = 'wl-first-msg-done';

// iOS Safari has no beforeinstallprompt. Detect it so we can render the
// "Condividi → Aggiungi a Home" instruction instead of the native button.
function isIosSafariStandaloneCapable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  if (!isIos) return false;
  // Already installed → don't prompt
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return false;
  // Only Safari proper supports add-to-home; Chrome/Firefox on iOS can't.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isSafari;
}

function isAlreadyStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosFallback, setIosFallback] = useState(false);
  const [firstMsgDone, setFirstMsgDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Read localStorage flags + listen for the first-message event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isAlreadyStandalone()) return; // Already installed → never show.

    try {
      setFirstMsgDone(localStorage.getItem(FIRST_MSG_FLAG) === '1');
      setDismissed(localStorage.getItem(DISMISSED_FLAG) === '1');
    } catch {
      // localStorage can throw in private mode — fail silent, no prompt.
      return;
    }

    setIosFallback(isIosSafariStandaloneCapable());

    const onFirstMsg = () => setFirstMsgDone(true);
    window.addEventListener(FIRST_MSG_EVENT, onFirstMsg);
    return () => window.removeEventListener(FIRST_MSG_EVENT, onFirstMsg);
  }, []);

  // Intercept the native prompt as soon as Chrome/Android offers it.
  // We don't wait for the first-msg flag here — capturing it early means we
  // still have a valid prompt() ref later when the banner becomes eligible.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    // If the app gets installed mid-session, swallow the banner immediately.
    const installed = () => {
      setDeferred(null);
      try { localStorage.setItem(DISMISSED_FLAG, '1'); } catch { /* ignore */ }
      setDismissed(true);
    };
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') {
        try { localStorage.setItem(DISMISSED_FLAG, '1'); } catch { /* ignore */ }
        setDismissed(true);
      }
    } catch {
      // ignore — user cancelled or browser rejected
    } finally {
      setDeferred(null);
    }
  }, [deferred]);

  const handleDismiss = useCallback(() => {
    try { localStorage.setItem(DISMISSED_FLAG, '1'); } catch { /* ignore */ }
    setDismissed(true);
  }, []);

  // Visibility gate: only after first scheduled message, never if dismissed,
  // and we need either a deferred prompt (Chrome/Android) or the iOS fallback.
  const visible = firstMsgDone && !dismissed && (deferred !== null || iosFallback);
  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Aggiungi WhatsLater alla schermata Home"
      className="fixed bottom-24 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[360px] z-toast bg-[#1F2C33] border border-[#2A3942] rounded-2xl p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <img
          src="/icons/icon-192.png"
          alt=""
          className="w-12 h-12 rounded-xl shrink-0"
          width={48}
          height={48}
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm">
            Aggiungi alla schermata Home
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {iosFallback
              ? 'Tocca Condividi e poi “Aggiungi a Home”.'
              : 'Apri WhatsLater con un tap.'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Chiudi"
          className="text-gray-500 hover:text-gray-300 -m-1 p-1 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={handleDismiss}
          className="text-xs font-medium text-gray-400 hover:text-gray-200 px-3 py-2"
        >
          Più tardi
        </button>
        {deferred ? (
          <button
            type="button"
            onClick={handleInstall}
            className="text-sm font-semibold bg-[#25D366] hover:bg-[#1ebe5b] text-white rounded-full px-4 py-2 transition-colors"
          >
            Aggiungi
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-300 bg-[#202C33] border border-[#2A3942] rounded-full px-3 py-2">
            <Share className="w-3.5 h-3.5" /> Condividi
          </span>
        )}
      </div>
    </div>
  );
}
