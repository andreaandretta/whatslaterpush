'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share, CheckCircle2, MoreVertical, SquarePlus } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import Logo from '@/components/Logo';

// Compact install pill in the dashboard header. Single tap path:
//  - Native prompt available (Chrome/Android/desktop) → fire it, then a
//    "App installata!" toast on accept.
//  - No native prompt → open a bottom sheet with the right copy for iOS,
//    desktop-site-on-phone, or generic browser menu. iOS has no
//    beforeinstallprompt, so this guide is the ONLY install path on iPhone.
//  - Already installed (standalone) → renders nothing.
//
// The sheet + toast are rendered through a PORTAL to document.body. The button
// lives inside the dashboard <nav>, which has `backdrop-blur-md`
// (backdrop-filter). A filtered/transformed ancestor becomes the containing
// block for `position: fixed` descendants, so a `fixed inset-0` overlay would
// otherwise anchor to the 48px navbar instead of the viewport — that's what
// shoved the iOS guide off the top of the screen behind the status bar (only
// "3. Conferma con Aggiungi" was visible). The portal escapes the navbar so the
// bottom sheet sits at the real viewport bottom, safe-area aware.
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

  // While the sheet is open: lock body scroll + close on Esc.
  useEffect(() => {
    if (!showSheet) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSheet(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [showSheet]);

  const handleClick = useCallback(async () => {
    if (deferred) {
      const outcome = await install();
      if (outcome === 'accepted') celebrate();
      return;
    }
    setShowSheet(true);
  }, [deferred, install, celebrate]);

  // Render whenever mounted && !installed — note this is NOT gated on
  // `deferred`, so the button stays visible on iOS (where deferred is always
  // null) and is the entry point to the install guide.
  if (!mounted || installed) return null;

  const closeSheet = () => setShowSheet(false);

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

      {/* Bottom sheet — portaled to <body> so the navbar's backdrop-filter
          doesn't capture our position:fixed (see the file header). */}
      {showSheet && mounted && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Come installare l'app"
          className="fixed inset-0 z-[80]"
        >
          <div className="absolute inset-0 bg-black/60" onClick={closeSheet} />
          <div className="absolute inset-x-0 bottom-0 bg-[#1F2C33] border-t border-[#2A3942] rounded-t-2xl shadow-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-w-md mx-auto animate-slide-up">
            <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mb-3" />

            <div className="flex items-center gap-2 mb-3">
              <Logo size={22} ringColor="#1F2C33" />
              <p className="text-sm font-bold text-white">
                {ios ? 'Installa WhatsLater su iPhone' : 'Installa WhatsLater'}
              </p>
            </div>

            {ios ? (
              <ol className="space-y-2.5 text-xs text-gray-200">
                <li className="flex items-center gap-2.5">
                  <Step n="1" /><span>Tocca <ShareIcon /> <b>Condividi</b> (in basso)</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Step n="2" /><span>Scorri e tocca <b>&ldquo;Aggiungi a Home&rdquo;</b> <SquarePlus className="inline-block w-4 h-4 align-text-bottom" aria-hidden="true" /></span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Step n="3" /><span>Conferma con <b>&ldquo;Aggiungi&rdquo;</b></span>
                </li>
              </ol>
            ) : desktopMode ? (
              <div className="text-xs leading-relaxed text-gray-200 space-y-2.5">
                <p>Hai la modalit&agrave; <b>&ldquo;Sito desktop&rdquo;</b> attiva: cos&igrave; Chrome non consente di installare l&rsquo;app.</p>
                <ol className="space-y-2.5">
                  <li className="flex items-center gap-2.5"><Step n="1" /><span>Tocca <MoreVertical className="inline-block w-4 h-4 align-text-bottom" aria-hidden="true" /> in Chrome</span></li>
                  <li className="flex items-center gap-2.5"><Step n="2" /><span><b>Deseleziona &ldquo;Sito desktop&rdquo;</b></span></li>
                  <li className="flex items-center gap-2.5"><Step n="3" /><span>Ricarica e tocca <b>Installa app</b></span></li>
                </ol>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-gray-200">
                Apri il menu del browser (i tre puntini) e scegli <b>&ldquo;Installa app&rdquo;</b> oppure <b>&ldquo;Aggiungi a schermata Home&rdquo;</b>. Su Chrome desktop l&rsquo;icona di installazione &egrave; nella barra degli indirizzi.
              </p>
            )}

            <button
              type="button"
              onClick={closeSheet}
              className="w-full mt-4 text-xs text-gray-400 hover:text-gray-200 py-2"
            >
              Ho capito
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* Toast portaled too — it's a sibling `fixed` element that would hit the
          same navbar containing-block trap otherwise. */}
      {showToast && mounted && createPortal(
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-toast">
          <div className="flex items-center gap-2 bg-green-600 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-2xl whitespace-nowrap">
            <CheckCircle2 className="w-4 h-4" /> App installata!
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Green numbered step bullet.
function Step({ n }: { n: string }) {
  return (
    <span className="flex items-center justify-center w-5 h-5 shrink-0 rounded-full bg-[#25D366] text-[#0b141a] text-[11px] font-bold">
      {n}
    </span>
  );
}

// iOS "Share" glyph (arrow out of a box) tinted iOS-blue so the step copy
// matches what the user actually sees in Safari's toolbar.
function ShareIcon() {
  return <Share className="inline-block w-4 h-4 shrink-0 align-text-bottom" style={{ color: '#53BDEB' }} aria-hidden="true" />;
}
