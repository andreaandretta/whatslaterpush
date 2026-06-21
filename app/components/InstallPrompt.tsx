'use client';

import { useCallback, useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

const DISMISSED_FLAG = 'wl_install_dismissed';
const FIRST_MSG_FLAG = 'wl_first_msg_done';

export default function InstallPrompt() {
  const { mounted, installed, deferred, ios, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);
  // Silent principle: don't pitch "install" to someone who hasn't sent a
  // single message yet. The dashboard sets wl_first_msg_done + fires the
  // `wl-first-msg-done` event on the user's first successful schedule; we gate
  // on the flag AND listen for the event so the banner surfaces on that exact
  // transition (and stays hidden before it). This gate had regressed — the flag
  // was still being written by the dashboard but no longer read here.
  const [firstMsgDone, setFirstMsgDone] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_FLAG) === '1');
      setFirstMsgDone(localStorage.getItem(FIRST_MSG_FLAG) === '1');
    } catch {
      // private mode / disabled storage — fail silent, no prompt.
    }
    const onFirstMsg = () => setFirstMsgDone(true);
    window.addEventListener('wl-first-msg-done', onFirstMsg);
    return () => window.removeEventListener('wl-first-msg-done', onFirstMsg);
  }, []);

  const handleInstall = useCallback(async () => {
    const outcome = await install();
    if (outcome === 'accepted') {
      try { localStorage.setItem(DISMISSED_FLAG, '1'); } catch { /* ignore */ }
      setDismissed(true);
    }
  }, [install]);

  const handleDismiss = useCallback(() => {
    try { localStorage.setItem(DISMISSED_FLAG, '1'); } catch { /* ignore */ }
    setDismissed(true);
  }, []);

  // Visibility gate: only mounted, not installed, not dismissed, and we
  // need either a deferred prompt (Chrome/Android) or the iOS fallback.
  if (!mounted || installed || dismissed || !firstMsgDone) return null;
  if (deferred === null && !ios) return null;

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
            {ios
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
            className="inline-flex items-center gap-1.5 text-sm font-semibold bg-[#25D366] hover:bg-[#1ebe5b] text-white rounded-full px-4 py-2 transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="6" y="2" width="12" height="20" rx="3" />
              <path d="M12 7v6" />
              <path d="m9.5 10.5 2.5 2.5 2.5-2.5" />
            </svg>
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
